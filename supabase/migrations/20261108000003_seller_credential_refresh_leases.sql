-- Local-only Seller credential refresh lease. No scheduler is introduced here.
create function public.acquire_seller_credential_refresh(p_connection uuid, p_worker uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.seller_credentials; v_workspace uuid; v_open_id text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if p_connection is null or p_worker is null then raise exception 'invalid refresh lease' using errcode='22023'; end if;
 select c.workspace_id,c.seller_open_id into v_workspace,v_open_id from public.seller_connections c where c.id=p_connection and c.status='CONNECTED' for update;
 select * into v from public.seller_credentials where connection_id=p_connection for update;
 if not found then return jsonb_build_object('state','REAUTH_REQUIRED'); end if;
 if v.refresh_lease_expires_at is not null and v.refresh_lease_expires_at > clock_timestamp() then return jsonb_build_object('state','BUSY'); end if;
 if v.refresh_lease_expires_at is not null then
   update public.seller_connections set status='REAUTH_REQUIRED',updated_at=now() where id=p_connection;
   insert into public.seller_audit_events(workspace_id,connection_id,event_type,metadata) values(v_workspace,p_connection,'REAUTH_REQUIRED','{"reason":"LEASE_EXPIRED"}'::jsonb);
   return jsonb_build_object('state','REAUTH_REQUIRED');
 end if;
 if v.refresh_expires_at <= clock_timestamp() then
   update public.seller_connections set status='REAUTH_REQUIRED',updated_at=now() where id=p_connection;
   insert into public.seller_audit_events(workspace_id,connection_id,event_type,metadata) values(v_workspace,p_connection,'REAUTH_REQUIRED','{"reason":"REFRESH_EXPIRED"}'::jsonb);
   return jsonb_build_object('state','REAUTH_REQUIRED');
 end if;
 update public.seller_credentials set refresh_lease_owner=p_worker,refresh_lease_expires_at=clock_timestamp()+interval '90 seconds',refresh_fencing_token=refresh_fencing_token+1,updated_at=now() where connection_id=p_connection returning * into v;
 insert into public.seller_audit_events(workspace_id,connection_id,event_type) values(v_workspace,p_connection,'REFRESH_STARTED');
 return jsonb_build_object('state','ACQUIRED','workspace_id',v_workspace,'seller_open_id',v_open_id,'credential_version',v.credential_version,'fencing_token',v.refresh_fencing_token);
end $$;

create function public.read_seller_refresh_credential(p_connection uuid,p_worker uuid,p_fencing bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.seller_credentials; v_workspace uuid; v_open_id text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 select c.workspace_id,c.seller_open_id into v_workspace,v_open_id from public.seller_connections c where c.id=p_connection for update;
 select * into v from public.seller_credentials where connection_id=p_connection and refresh_lease_owner=p_worker and refresh_fencing_token=p_fencing and refresh_lease_expires_at>clock_timestamp() for update;
 if not found then raise exception 'refresh lease lost' using errcode='42501'; end if;
 return jsonb_build_object('workspace_id',v_workspace,'seller_open_id',v_open_id,'refresh_ciphertext',v.refresh_token_ciphertext,'encryption_key_version',v.encryption_key_version,'credential_version',v.credential_version);
end $$;

create function public.complete_seller_credential_refresh(p_connection uuid,p_worker uuid,p_fencing bigint,p_version bigint,p_enc_access text,p_enc_refresh text,p_access_exp timestamptz,p_refresh_exp timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_workspace uuid; v_rows integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if coalesce(p_enc_access,'')='' or coalesce(p_enc_refresh,'')='' or p_access_exp<=clock_timestamp() or p_refresh_exp<p_access_exp then raise exception 'invalid refresh payload' using errcode='22023'; end if;
 update public.seller_credentials set access_token_ciphertext=p_enc_access,refresh_token_ciphertext=p_enc_refresh,access_expires_at=p_access_exp,refresh_expires_at=p_refresh_exp,credential_version=credential_version+1,refresh_lease_owner=null,refresh_lease_expires_at=null,updated_at=now() where connection_id=p_connection and credential_version=p_version and refresh_fencing_token=p_fencing and refresh_lease_owner=p_worker and refresh_lease_expires_at>clock_timestamp();
 get diagnostics v_rows=row_count; if v_rows<>1 then return false; end if;
 select workspace_id into v_workspace from public.seller_connections where id=p_connection;
 insert into public.seller_audit_events(workspace_id,connection_id,event_type) values(v_workspace,p_connection,'REFRESH_COMPLETED'); return true;
end $$;

create function public.fail_seller_credential_refresh(p_connection uuid,p_worker uuid,p_fencing bigint,p_version bigint,p_reason text,p_reauth boolean default true)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_workspace uuid; v_rows integer;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 if p_reason not in ('REFRESH_REMOTE_FAILED','REFRESH_OUTCOME_UNKNOWN','REFRESH_CONTEXT_INVALID','REFRESH_DECRYPT_FAILED') then raise exception 'invalid refresh reason' using errcode='22023'; end if;
 update public.seller_credentials set refresh_lease_owner=null,refresh_lease_expires_at=null,updated_at=now() where connection_id=p_connection and credential_version=p_version and refresh_fencing_token=p_fencing and refresh_lease_owner=p_worker;
 get diagnostics v_rows=row_count; if v_rows<>1 then return false; end if;
 select workspace_id into v_workspace from public.seller_connections where id=p_connection;
 if p_reauth then update public.seller_connections set status='REAUTH_REQUIRED',updated_at=now() where id=p_connection; insert into public.seller_audit_events(workspace_id,connection_id,event_type,metadata) values(v_workspace,p_connection,'REAUTH_REQUIRED',jsonb_build_object('reason',p_reason)); else insert into public.seller_audit_events(workspace_id,connection_id,event_type,metadata) values(v_workspace,p_connection,'REFRESH_FAILED',jsonb_build_object('reason',p_reason)); end if;
 return true;
end $$;

revoke execute on function public.acquire_seller_credential_refresh(uuid,uuid),public.read_seller_refresh_credential(uuid,uuid,bigint),public.complete_seller_credential_refresh(uuid,uuid,bigint,bigint,text,text,timestamptz,timestamptz),public.fail_seller_credential_refresh(uuid,uuid,bigint,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.acquire_seller_credential_refresh(uuid,uuid),public.read_seller_refresh_credential(uuid,uuid,bigint),public.complete_seller_credential_refresh(uuid,uuid,bigint,bigint,text,text,timestamptz,timestamptz),public.fail_seller_credential_refresh(uuid,uuid,bigint,bigint,text,boolean) to service_role;
