-- Like every Medoro table: row level security on, so a hosted data API gets no rows.
ALTER TABLE public."HrExit" ENABLE ROW LEVEL SECURITY;
