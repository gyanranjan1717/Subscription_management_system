### Benchmark results

- Environment: Node v24.16.0, win32 x64, 12th Gen Intel(R) Core(TM) i5-1235U (12 threads), SQLite via node:sqlite (WAL), file database
- Dataset (built in 1.0 s): 2000 customers, 5000 subscriptions, 25024 invoices, 17891 payments, 500 subscriptions due today, 6245 overdue invoices
- Method: real HTTP requests to the real Express app, 20 timed runs after 1 warm-up, milliseconds

| Endpoint | median | p95 | max |
|---|---:|---:|---:|
| Finance dashboard summary | 35.0 | 55.9 | 75.3 |
| Dashboard with date range | 107.9 | 131.7 | 135.7 |
| Subscriptions list, page 1 | 4.6 | 5.9 | 5.9 |
| Subscriptions, status=Active, page 1 | 12.0 | 22.2 | 78.9 |
| Subscriptions, deep page (page 40) | 4.4 | 5.5 | 6.5 |
| Subscriptions, search by number prefix | 4.7 | 11.5 | 23.7 |
| Invoices list, page 1 | 3.2 | 5.3 | 7.0 |
| Invoices, status=Confirmed | 64.6 | 70.7 | 71.5 |
| Invoices, overdue only | 68.2 | 92.9 | 105.3 |
| Invoices, deep page (page 200) | 8.7 | 10.2 | 26.2 |
| Invoices, date range | 43.6 | 61.9 | 62.6 |
| Invoice detail with lines and payments | 2.1 | 2.7 | 2.7 |
| Payments list, page 1 | 11.8 | 13.3 | 14.2 |
| Payments, date range + method | 37.7 | 43.8 | 45.1 |
| Customer portal: own subscriptions | 2.4 | 7.5 | 7.9 |
| Customer portal: own invoices | 2.5 | 3.0 | 3.3 |
| Billing integrity report | 175.5 | 234.8 | 236.5 |

| Billing operation | result | time |
|---|---|---:|
| Dry run (compute, then roll back) | 500 invoices, 0 errors | 128 ms |
| Real billing run | 500 invoices created, 0 errors | 524 ms |
| Second run, same date | 0 invoices created | 0 ms |
| Integrity report (25524 invoices) | duplicates 0, missing 0, ok=true | 172 ms |

Query plans:
- Due subscriptions: SEARCH subscriptions USING COVERING INDEX idx_subscriptions_status_billing (status=? AND next_billing_date<?)
- Customer invoices: SEARCH invoices USING COVERING INDEX idx_invoices_customer (customer_id=?)
- Overdue invoices: SEARCH invoices USING INDEX idx_invoices_status_due (status=? AND due_date<?)
- Payments of an invoice: SEARCH payments USING COVERING INDEX idx_payments_invoice (invoice_id=?)
- Payments by date: SEARCH payments USING INDEX idx_payments_date (payment_date>? AND payment_date<?)
- Invoice period lookup: SEARCH invoices USING COVERING INDEX sqlite_autoindex_invoices_2 (subscription_id=? AND period_start=?)

Slowest single request: 236.5 ms; SLA (< 2000 ms) met.
