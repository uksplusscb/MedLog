import { useEffect, useState } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  deleteDoc,
  doc,
  collectionGroup 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Visit } from '../types';
import { formatDate, cn } from '../lib/utils';
import { Search, User, Clock, Thermometer, Activity, Loader2, Trash2, FileText } from 'lucide-react';

export default function VisitList() {
  const [visits, setVisits] = useState<(Visit & { path: string })[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collectionGroup(db, 'visits'), orderBy('date', 'desc'), limit(50));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(docSnap => ({ 
        id: docSnap.id, 
        path: docSnap.ref.path,
        ...docSnap.data() 
      } as Visit & { path: string }));
      setVisits(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, 'visits_collection_group');
    });

    return () => unsubscribe();
  }, []);

  const filteredVisits = visits.filter(v => 
    (v.studentName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.grade || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.complaint || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const safeLocaleDate = (dateVal: string | undefined) => {
    if (!dateVal) return '-';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch (e) {
      return '-';
    }
  };

  const safeLocaleTime = (dateVal: string | undefined) => {
    if (!dateVal) return '-';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '-';
    }
  };

  const handleDelete = async (path: string) => {
    if (!window.confirm('Hapus data kunjungan ini?')) return;
    try {
      await deleteDoc(doc(db, path));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
        <h2 className="text-xs font-bold uppercase text-slate-500 tracking-wider px-2">Data Terakhir (Hari Ini)</h2>
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Cari..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 rounded bg-slate-50 border border-slate-200 focus:ring-1 focus:ring-blue-500 outline-none text-[11px] transition-all"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-bold tracking-wider sticky top-0 bg-white">
              <tr className="border-b border-slate-100">
                <th className="p-3">Waktu</th>
                <th className="p-3">Nama Siswa</th>
                <th className="p-3">Kelas</th>
                <th className="p-3">Vital</th>
                <th className="p-3">Keluhan</th>
                <th className="p-3">Diagnosa</th>
                <th className="p-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" />
                  </td>
                </tr>
              ) : filteredVisits.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400 italic">
                    Tidak ada data ditemukan
                  </td>
                </tr>
              ) : filteredVisits.map((visit, i) => (
                <tr key={visit.id} className={cn("hover:bg-slate-50/80 transition-colors group", i % 2 !== 0 ? "bg-slate-50/30" : "")}>
                  <td className="p-3 font-mono text-slate-400 text-[10px] whitespace-nowrap">
                    <span className="block text-slate-600 font-bold mb-0.5">
                      {safeLocaleDate(visit.date)}
                    </span>
                    {safeLocaleTime(visit.date)}
                  </td>
                  <td className="p-3 font-bold text-slate-900">
                    <div className="flex flex-col gap-1">
                      <span>{visit.studentName}</span>
                      {visit.labPhoto && (() => {
                        const segments = visit.path.split('/');
                        const studentId = segments[1];
                        const visitId = segments[3];
                        return (
                          <a
                            href={`/?view-lab=${studentId}_${visitId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 bg-cyan-100 hover:bg-cyan-200 text-cyan-800 font-extrabold uppercase text-[8px] tracking-wider px-1.5 py-0.5 rounded w-fit border border-cyan-200/40"
                          >
                            <FileText className="w-2.5 h-2.5 text-cyan-600" />
                            <span>HASIL LAB</span>
                          </a>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="p-3 text-slate-500 font-medium">{visit.grade}</td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{visit.temperature}&deg;C</span>
                      <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{visit.bloodPressure}</span>
                    </div>
                  </td>
                  <td className="p-3 text-slate-600 max-w-[200px] truncate">{visit.complaint}</td>
                  <td className="p-3 font-medium text-blue-600">{visit.diagnosis || '-'}</td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => visit.path && handleDelete(visit.path)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Hapus"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
