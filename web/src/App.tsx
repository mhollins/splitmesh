import { Navigate, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/Admin";
import { AthletesPage } from "./pages/Athletes";
import { HomePage } from "./pages/Home";
import { LiveEventPage } from "./pages/LiveEvent";
import { LoginPage } from "./pages/Login";
import { MeetPage } from "./pages/Meet";
import { TeamSettingsPage } from "./pages/TeamSettings";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/app" element={<HomePage />} />
      <Route path="/athletes" element={<AthletesPage />} />
      <Route path="/team" element={<TeamSettingsPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/meets/:meetId" element={<MeetPage />} />
      <Route path="/events/:eventId/live" element={<LiveEventPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
