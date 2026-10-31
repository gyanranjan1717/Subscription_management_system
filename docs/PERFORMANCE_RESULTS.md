### Benchmark results

- Environment: Node v24.16.0, win32 x64, 12th Gen Intel(R) Core(TM) i5-1235U (12 threads), SQLite via node:sqlite (WAL), file database
- Dataset (built in 0.8 s): 2000 customers, 5000 subscriptions, 25024 invoices, 17891 payments, 500 subscriptions due today, 6245 overdue invoices
- Method: real HTTP requests to the real Express app, 20 timed runs after 1 warm-up, milliseconds

| Endpoint | median | p95 | max |
|---|---:|---:|---:|
| Finance dashboard summary | 34.1 | 36.2 | 37.9 |
| Dashboard with date range | 46.6 | 47.9 | 49.8 |
| Subscriptions list, page 1 | 1.1 | 1.3 | 2.1 |
| Subscriptions, status=Active, page 1 | 4.6 | 6.4 | 9.8 |
| Subscriptions, deep page (page 40) | 1.3 | 1.7 | 2.5 |
| Subscriptions, search by number prefix | 1.5 | 2.3 | 2.7 |
| Invoices list, page 1 | 1.1 | 2.0 | 2.0 |
| Invoices, status=Confirmed | 22.1 | 23.5 | 24.2 |
| Invoices, overdue only | 25.6 | 27.2 | 27.7 |
| Invoices, deep page (page 200) | 3.6 | 4.0 | 4.1 |
| Invoices, date range | 15.8 | 21.4 | 28.6 |
| Invoice detail with lines and payments | 0.7 | 0.8 | 0.9 |
| Payments list, page 1 | 4.3 | 4.8 | 5.1 |
| Payments, date range + method | 14.7 | 17.6 | 18.3 |
| Customer portal: own subscriptions | 0.8 | 1.0 | 1.1 |
| Customer portal: own invoices | 0.8 | 1.1 | 1.5 |
| Billing integrity report | 62.5 | 64.0 | 67.5 |

| Billing operation | result | time |
|---|---|---:|
| Dry run (compute, then roll back) | 500 invoices, 0 errors | 54 ms |
| Real billing run | 500 invoices created, 0 errors | 184 ms |
| Second run, same date | 0 invoices created | 0 ms |
| Integrity report (25524 invoices) | duplicates 0, missing 0, ok=true | 61 ms |

Query plans:
- Due subscriptions: SEARCH subscriptions USING COVERING INDEX idx_subscriptions_status_billing (status=? AND next_billing_date<?)
- Customer invoices: SEARCH invoices USING COVERING INDEX idx_invoices_customer (customer_id=?)
- Overdue invoices: SEARCH invoices USING INDEX idx_invoices_status_due (status=? AND due_date<?)
- Payments of an invoice: SEARCH payments USING COVERING INDEX idx_payments_invoice (invoice_id=?)
- Payments by date: SEARCH payments USING INDEX idx_payments_date (payment_date>? AND payment_date<?)
- Invoice period lookup: SEARCH invoices USING COVERING INDEX sqlite_autoindex_invoices_2 (subscription_id=? AND period_start=?)

Slowest single request: 67.5 ms; SLA (< 2000 ms) met.
