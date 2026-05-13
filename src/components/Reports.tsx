import { useEffect, useState } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  Timestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Visit } from '../types';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { id } from 'date-fns/locale';
import { 
  Download, 
  FileText, 
  Activity, 
  ChevronDown, 
  PieChart as PieIcon,
  Filter
} from 'lucide-react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Legend, 
  Tooltip 
} from 'recharts';

export default function Reports() {
  const [loading, setLoading] = useState(false);
  const [reportMonth, setReportMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [reportData, setReportData] = useState<{
    visits: Visit[];
    diagnosisCounts: Record<string, number>;
    gradeCounts: Record<string, number>;
    totalFemale: number;
    totalMale: number;
  }>({
    visits: [],
    diagnosisCounts: {},
    gradeCounts: {},
    totalFemale: 0,
    totalMale: 0
  });

  const generateReport = async () => {
    setLoading(true);
    try {
      const targetDate = new Date(reportMonth);
      const start = startOfMonth(targetDate);
      const end = endOfMonth(targetDate);

      const q = query(
        collection(db, 'visits'),
        where('createdAt', '>=', Timestamp.fromDate(start)),
        where('createdAt', '<=', Timestamp.fromDate(end))
      );

      const snap = await getDocs(q);
      const visits = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Visit));

      const diagnosisCounts: Record<string, number> = {};
      const gradeCounts: Record<string, number> = {};
      let females = 0;
      let males = 0;

      visits.forEach(v => {
        const diag = v.diagnosis || 'Tanpa Diagnosa';
        diagnosisCounts[diag] = (diagnosisCounts[diag] || 0) + 1;
        
        gradeCounts[v.grade] = (gradeCounts[v.grade] || 0) + 1;
        
        if (v.gender === 'Perempuan') females++;
        else males++;
      });

      setReportData({
        visits,
        diagnosisCounts,
        gradeCounts,
        totalFemale: females,
        totalMale: males
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generateReport();
  }, [reportMonth]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
  
  const pieData = Object.entries(reportData.diagnosisCounts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => Number(b.value) - Number(a.value))
    .slice(0, 5);

  const printReport = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print:p-0">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-lg border border-slate-200 shadow-sm print:hidden h-16">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-blue-600 rounded-full" />
          <h2 className="text-sm font-bold text-slate-800 tracking-tight uppercase">Laporan Analitik Bulanan</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input 
              type="month" 
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              className="pl-9 pr-4 py-1.5 border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-500 text-[11px] font-bold uppercase transition-all bg-slate-50"
            />
          </div>
          <button 
            onClick={printReport}
            className="bg-slate-900 text-white px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-bold shadow-sm uppercase tracking-widest hover:bg-slate-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col print:border-none">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-sm font-black text-slate-900 uppercase tracking-tighter">Medical_Report_Summary</h1>
            <p className="text-[10px] font-bold text-slate-400 uppercase font-mono">Month_Cycle: {format(new Date(reportMonth), 'MM_yyyy')}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Periode Laporan</p>
            <p className="text-[11px] font-black text-blue-600 uppercase italic">{format(new Date(reportMonth), 'MMMM yyyy', { locale: id })}</p>
          </div>
        </div>

        <div className="p-4 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3 bg-slate-50 rounded border border-slate-100">
              <p className="label-caps mb-1 opacity-60">Total Kunjungan</p>
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-black text-slate-900 font-mono">{reportData.visits.length}</p>
                <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              </div>
            </div>
            <div className="p-3 bg-blue-50/50 rounded border border-blue-100">
              <p className="label-caps mb-1 !text-blue-500">Demo_Gender_Male</p>
              <p className="text-2xl font-black text-blue-900 font-mono">{reportData.totalMale}</p>
            </div>
            <div className="p-3 bg-rose-50/50 rounded border border-rose-100">
              <p className="label-caps mb-1 !text-rose-500">Demo_Gender_Female</p>
              <p className="text-2xl font-black text-rose-900 font-mono">{reportData.totalFemale}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-slate-50">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
                <h3 className="label-caps">Top_Diagnosis_Cluster</h3>
              </div>
              <div className="h-[220px] w-full bg-slate-50/50 rounded">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={65}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ borderRadius: '4px', border: 'none', fontSize: '10px', background: '#fff', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
                <h3 className="label-caps">Grade_Distribution_Matrix</h3>
              </div>
              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                {Object.entries(reportData.gradeCounts).map(([grade, count]) => (
                  <div key={grade} className="flex items-center justify-between p-2.5 bg-slate-50 rounded border-l-2 border-blue-600">
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-tight">KLS_{grade}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-20 bg-slate-200 h-1 rounded-full overflow-hidden">
                        <div 
                          className="bg-blue-600 h-full" 
                          style={{ width: `${reportData.visits.length > 0 ? (Number(count) / reportData.visits.length) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-black text-slate-900 font-mono">{count}</span>
                    </div>
                  </div>
                ))}
                {Object.keys(reportData.gradeCounts).length === 0 && (
                  <p className="text-center text-slate-400 py-12 text-[10px] font-bold uppercase italic tracking-widest">NULL_DATA</p>
                )}
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-50">
            <h3 className="label-caps mb-4">Detailed_Audit_Log</h3>
            <div className="overflow-x-auto rounded border border-slate-100">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead className="bg-slate-50 text-slate-400 uppercase text-[9px] font-bold tracking-widest border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Subject_Name</th>
                    <th className="px-4 py-3">Grade</th>
                    <th className="px-4 py-3">Clinical_Notes</th>
                    <th className="px-4 py-3">Protocol</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 font-medium">
                  {reportData.visits.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-400 text-[10px]">
                        {format(new Date(v.date), 'dd/MM/yy')}
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-800 uppercase tracking-tight">{v.studentName}</td>
                      <td className="px-4 py-3 text-slate-500 font-bold">{v.grade}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">{v.complaint}</td>
                      <td className="px-4 py-3 font-bold text-blue-600 uppercase tracking-tighter">{v.diagnosis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
