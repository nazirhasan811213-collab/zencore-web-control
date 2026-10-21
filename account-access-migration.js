'use strict';
module.exports=String.raw`
ALTER TABLE zencore_users ADD COLUMN IF NOT EXISTS access_activated_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS access_expires_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS zencore_access_renewals (
 id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES zencore_users(id) ON DELETE CASCADE,
 admin_id UUID REFERENCES zencore_users(id) ON DELETE SET NULL, activated_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE OR REPLACE FUNCTION zencore_account_access_period() RETURNS trigger AS $access$
BEGIN
 IF NEW.role <> 'client' THEN
  NEW.access_activated_at := NULL; NEW.access_expires_at := NULL;
 ELSIF NEW.status = 'active' AND NEW.access_expires_at IS NULL THEN
  NEW.access_activated_at := NOW(); NEW.access_expires_at := NOW()+INTERVAL '336 hours';
 END IF;
 RETURN NEW;
END; $access$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS zencore_users_access_period ON zencore_users;
CREATE TRIGGER zencore_users_access_period BEFORE INSERT OR UPDATE OF role,status,access_expires_at
 ON zencore_users FOR EACH ROW EXECUTE FUNCTION zencore_account_access_period();
-- Only missing periods are backfilled. Deploys and restarts never renew an existing period.
WITH assigned AS (
 UPDATE zencore_users SET access_activated_at=NOW(),access_expires_at=NOW()+INTERVAL '336 hours'
 WHERE role='client' AND status IN ('active','disabled') AND access_expires_at IS NULL RETURNING id)
SELECT COUNT(*)::int AS initialized_clients FROM assigned;
`;
