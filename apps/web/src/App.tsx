import { Navigate, Route, Routes } from 'react-router-dom';
import { HealthPage } from './pages/HealthPage';

/**
 * The whole route tree. Declarative routes only — no data router, no loaders
 * and no framework mode (tech-stack §4.1).
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HealthPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
