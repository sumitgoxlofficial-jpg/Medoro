-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."HrPolicyAck" ENABLE ROW LEVEL SECURITY;
