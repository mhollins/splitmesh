import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/Home";
import { LiveEventPage } from "./pages/LiveEvent";
import { LoginPage } from "./pages/Login";
import { MeetPage } from "./pages/Meet";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/app" element={<HomePage />} />
      <Route path="/meets/:meetId" element={<MeetPage />} />
      <Route path="/events/:eventId/live" element={<LiveEventPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
