import { Navigate, Route, Routes } from 'react-router-dom';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { HealthPage } from './pages/HealthPage';
import { IntakeDonePage } from './pages/IntakeDonePage';
import { IntakePage } from './pages/IntakePage';
import { ReviewDetailPage } from './pages/ReviewDetailPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { RowsPage } from './pages/RowsPage';
import { RulesPage } from './pages/RulesPage';

/**
 * The whole route tree. Declarative routes only — no data router, no loaders
 * and no framework mode (tech-stack §4.1).
 *
 * The rules screen is what the console is for, so it owns `/` by redirect.
 * `/rows` sits beside it (1.6) — the same dataset seen through its rows
 * rather than through the rules. `/duplicates` sits beside both (1.7.4) — the
 * links the duplicate rules found. `/review` is the staff side of B5/B6
 * (2.4). `/health` keeps the scaffold's page reachable rather than deleting
 * proof that the two halves of the repository talk to each other.
 *
 * `/intake` and its two sub-routes (2.3, 2.0) are the one patient-facing
 * corner of this app — they render no `AppNav` of their own (2.0's route
 * table: "no staff nav"), so they are declared here rather than folded under
 * a shared staff layout the way every other route above is.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/rules" element={<RulesPage />} />
      <Route path="/rows" element={<RowsPage />} />
      <Route path="/duplicates" element={<DuplicatesPage />} />
      <Route path="/review" element={<ReviewQueuePage />} />
      <Route path="/review/:id" element={<ReviewDetailPage />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="/intake" element={<IntakePage />} />
      <Route path="/intake/:id/done" element={<IntakeDonePage />} />
      <Route path="/intake/:id/:step" element={<IntakePage />} />
      <Route path="/" element={<Navigate to="/rules" replace />} />
      <Route path="*" element={<Navigate to="/rules" replace />} />
    </Routes>
  );
}
