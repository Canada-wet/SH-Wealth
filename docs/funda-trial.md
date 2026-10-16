# Funda 单次浏览器交互试验

This is an explicitly requested one-time UI query, not a recurring crawler. No Funda password, cookie, session token or hidden endpoint is stored or used by the app. No household amounts or files are sent to Funda.

The user-authorized response is retained in `wealth_research_archive`, isolated by household RLS. It contains the exact visible Copy message output, prompt, conversation URL, citations and capture time. `status=complete` means the answer finished, not that the research is complete or verified. `verification=ai-unverified` is mandatory even when the source labels its own facts “已核实”. The read-only app endpoint is authenticated, household-checked and no-store. Normal application users cannot insert, overwrite or delete archive rows; one-off imports use the existing trusted administrative path. The raw answer is never committed to Git, embedded in deployment source, sent to other AI models, or merged into household wealth or official market time series.

`captured_at` is collection time, not a market observation timestamp. Missing and third-party figures remain visible in the original response, not silently normalized into verified observations. One point is not a historical trend. Duplicate imports of the same conversation and content are prevented with a per-household content hash.

Run `supabase/research-archive.sql` after the existing access schema. Run `tests/research-archive.sql` for transactional member/outsider, read-only and duplicate checks; it uses synthetic households and rolls back. Unit and UI tests use synthetic answers only.

At the time of the initial trial, daily automation was not enabled. The user subsequently explicitly confirmed that Funda's authorized representatives approved the stated automated-query and private-storage scope. See `funda-recurring.md` for the authorized recurring workflow. A subscription alone does not establish that permission. Local browser scheduling requires an online runner and valid Chrome login; Vercel cannot directly control the user's local browser.
