-- Add Notion and Drive link fields to workflows
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS link_notion text;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS link_drive text;
