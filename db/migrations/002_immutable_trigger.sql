-- Compare record JSON rather than referencing fields absent on another table.
CREATE OR REPLACE FUNCTION protect_version_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mutable_fields text[];
BEGIN
 CASE TG_TABLE_NAME
  WHEN 'source_versions' THEN mutable_fields := ARRAY['freshness_checked_at','freshness_status'];
  WHEN 'reviewed_rules' THEN mutable_fields := ARRAY['superseded_at','revoked_at'];
  WHEN 'approvals' THEN mutable_fields := ARRAY['revoked_at'];
  WHEN 'merchant_policies' THEN mutable_fields := ARRAY['active'];
  ELSE RAISE EXCEPTION 'Unexpected immutable table';
 END CASE;
 IF (to_jsonb(NEW)-mutable_fields) IS DISTINCT FROM (to_jsonb(OLD)-mutable_fields) THEN
  RAISE EXCEPTION 'Evidence or approval payload is immutable';
 END IF;
 RETURN NEW;
END $$;
