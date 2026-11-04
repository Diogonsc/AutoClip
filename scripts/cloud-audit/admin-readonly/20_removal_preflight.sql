\set ON_ERROR_STOP on
\ir _guard.psql

-- Read-only preconditions for a separately approved no-CASCADE removal.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
SELECT jsonb_build_object(
  'role_present',r.oid IS NOT NULL,
  'marker_matches',coalesce(shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn',false),
  'no_login',coalesce(NOT r.rolcanlogin,false),
  'expired',coalesce(r.rolvaliduntil<=now(),false),
  'memberships_both_directions',coalesce((SELECT jsonb_agg(jsonb_build_object('granted_role',parent.rolname,'member',member.rolname,'admin_option',m.admin_option,'inherit_option',m.inherit_option,'set_option',m.set_option))
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
    WHERE m.roleid=r.oid OR m.member=r.oid),'[]'::jsonb),
  'active_sessions',coalesce((SELECT jsonb_agg(jsonb_build_object('pid',a.pid,'state',a.state,'backend_start',a.backend_start))
    FROM pg_stat_activity a WHERE a.usename=r.rolname AND a.pid<>pg_backend_pid()),'[]'::jsonb),
  'shared_dependencies',coalesce((SELECT jsonb_agg(jsonb_build_object('dependency_type',d.deptype,'catalog',d.classid::regclass::text,'object',pg_describe_object(d.classid,d.objid,d.objsubid))
    ORDER BY d.deptype,d.classid::regclass::text,d.objid,d.objsubid)
    FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid),'[]'::jsonb),
  'direct_target_connect',coalesce(EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname='postgres' AND a.grantee=r.oid AND a.privilege_type='CONNECT'),false)
) AS removal_preflight
FROM (VALUES(1)) x(dummy) LEFT JOIN pg_roles r ON r.rolname='autoclip_cloud_auditor';
COMMIT;
