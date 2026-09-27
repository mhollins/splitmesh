import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type SchoolRecord } from "../api";
import { formatDistanceLabel, formatMs, GENDER_LABELS } from "../format";

export function SchoolRecordsPage() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const [records, setRecords] = useState<SchoolRecord[]>([]);

  useEffect(() => {
    if (!schoolId) return;
    void api
      .schoolRecords(schoolId)
      .then((result) => setRecords(result.records))
      .catch(() => navigate("/app"));
  }, [schoolId]);

  const groups = new Map<string, SchoolRecord[]>();
  for (const record of records) {
    const list = groups.get(record.gender) ?? [];
    list.push(record);
    groups.set(record.gender, list);
  }

  return (
    <main className="page">
      <p>
        <Link to="/app">← Home</Link>
      </p>
      <h1>School records</h1>
      {records.length === 0 && <p className="muted">No school records yet.</p>}
      {[...groups.entries()].map(([gender, rows]) => (
        <section className="card" key={gender}>
          <h2>{GENDER_LABELS[gender as keyof typeof GENDER_LABELS] ?? gender}</h2>
          <ul className="plain">
            {rows.map((record) => (
              <li key={record.id}>
                <strong>
                  {formatDistanceLabel(record.distanceMeters)} {formatMs(record.markValueMs)}
                </strong>{" "}
                <span className="muted">
                  {record.firstName} {record.lastName}
                  {record.teamName ? ` · ${record.teamName}` : ""}
                  {record.meetName ? ` · ${record.meetName}` : ""}
                  {record.meetStartsOn ? ` · ${record.meetStartsOn}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
