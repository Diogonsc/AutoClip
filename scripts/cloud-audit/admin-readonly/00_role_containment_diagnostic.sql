\set ON_ERROR_STOP on
\ir _guard.psql

-- Read-only state check. Does not change role attributes or terminate sessions.
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';

SELECT jsonb_build_object(
  'role_present', r.oid IS NOT NULL,
  'role', r.rolname,
  'marker_matches', coalesce(shobj_description(r.oid,'pg_authid')='autoclip-cloud-audit:metadata-only:djrwfvcxgpyknmizqumn',false),
  'can_login', r.rolcanlogin,
  'valid_until', r.rolvaliduntil,
  'superuser', r.rolsuper,
  'inherit', r.rolinherit,
  'create_role', r.rolcreaterole,
  'create_db', r.rolcreatedb,
  'replication', r.rolreplication,
  'bypass_rls', r.rolbypassrls,
  'connection_limit', r.rolconnlimit,
  'database_privileges', jsonb_build_object(
    'connect', coalesce(has_database_privilege(r.rolname,current_database(),'CONNECT'),false),
    'create', coalesce(has_database_privilege(r.rolname,current_database(),'CREATE'),false),
    'temporary', coalesce(has_database_privilege(r.rolname,current_database(),'TEMP'),false)),
  'session_settings', coalesce((
    SELECT jsonb_object_agg(split_part(setting,'=',1),substr(setting,strpos(setting,'=')+1))
    FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) setting
    WHERE s.setrole=r.oid AND s.setdatabase=0
      AND split_part(setting,'=',1) IN ('default_transaction_read_only','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','search_path')
  ),'{}'::jsonb),
  'membership_edges', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'granted_role', parent.rolname,
      'member', member.rolname,
      'admin_option', m.admin_option,
      'inherit_option', m.inherit_option,
      'set_option', m.set_option)
      ORDER BY parent.rolname,member.rolname)
    FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid=m.roleid
    JOIN pg_roles member ON member.oid=m.member
    WHERE m.roleid=r.oid OR m.member=r.oid
  ),'[]'::jsonb),
  'effective_memberships', coalesce((
    SELECT jsonb_agg(granted.rolname ORDER BY granted.rolname)
    FROM pg_roles granted
    WHERE granted.oid<>r.oid AND pg_has_role(r.oid,granted.oid,'USAGE')
  ),'[]'::jsonb),
  'shared_dependencies', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'dependency_type',d.deptype,
      'catalog',d.classid::regclass::text,
      'object_description',pg_describe_object(d.classid,d.objid,d.objsubid))
      ORDER BY d.deptype,d.classid::regclass::text,d.objid,d.objsubid)
    FROM pg_shdepend d
    WHERE d.refclassid='pg_authid'::regclass AND d.refobjid=r.oid
  ),'[]'::jsonb),
  'active_sessions', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'pid',a.pid,'state',a.state,'backend_type',a.backend_type,
      'backend_start',a.backend_start,'transaction_start',a.xact_start)
      ORDER BY a.pid)
    FROM pg_stat_activity a WHERE a.usename=r.rolname AND a.pid<>pg_backend_pid()
  ),'[]'::jsonb),
  'active_session_count', (SELECT count(*) FROM pg_stat_activity a WHERE a.usename=r.rolname AND a.pid<>pg_backend_pid())
) AS role_containment_report
FROM (VALUES (1)) singleton(dummy)
LEFT JOIN pg_roles r ON r.rolname=:'audit_role';

COMMIT;
