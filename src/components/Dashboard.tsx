import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  limit, 
  Timestamp
} from 'firebase/firestore';
import { startOfMonth, endOfMonth } from 'date-fns';
import { db } from '../lib/firebase';
import { Visit, Medicine } from '../types';
import { 
  Users, 
  Activity, 
  Package, 
  Calendar,
  ChevronRight,
  TrendingUp,
  AlertCircle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';

export default function Dashboard({ setActiveTab }: { setActiveTab: (tab: string) => void }) {
  const [stats, setStats] = useState({
    todayVisits: 0,
    monthVisits: 0,
    lowStock: 0,
    uniqueStudents: 0
  });
  const [recentVisits, setRecentVisits] = useState<Visit[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);

  useEffect(() => {
    async function fetchData() {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMontVal = startOfMonth(now);
      
      const todayQ = query(collection(db, 'visits'), where('createdAt', '>=', Timestamp.fromDate(startOfToday)));
      const monthQ = query(collection(db, 'visits'), where('createdAt', '>=', Timestamp.fromDate(startOfMontVal)));
      const recentQ = query(collection(db, 'visits'), orderBy('date', 'desc'), limit(5));
      const medicinesCol = collection(db, 'medicines');

      // Fetch all in parallel
      const [todaySnap, monthSnap, medSnap, recentSnap] = await Promise.all([
        getDocs(todayQ),
        getDocs(monthQ),
        getDocs(medicinesCol),
        getDocs(recentQ)
      ]);

      const todayCount = todaySnap.size;
      const monthCount = monthSnap.size;
      const lowStockCount = medSnap.docs.filter(d => (d.data() as Medicine).stock < 10).length;
      const recent = recentSnap.docs.map(d => ({ id: d.id, ...d.data() } as Visit));

      setStats({
        todayVisits: todayCount,
        monthVisits: monthCount,
        lowStock: lowStockCount,
        uniqueStudents: Array.from(new Set(monthSnap.docs.map(d => (d.data() as Visit).studentName))).length
      });
      setRecentVisits(recent);

      // Simple Chart Data (Last 7 days)
      const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      const last7Days = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return {
          name: days[d.getDay()],
          count: 0,
          dateLabel: d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
        };
      }).reverse();

      monthSnap.docs.forEach(doc => {
        const data = doc.data() as Visit;
        const vDate = new Date(data.date);
        const dayMatch = last7Days.find(d => d.dateLabel === vDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }));
        if (dayMatch) dayMatch.count++;
      });
      setChartData(last7Days);
    }

    fetchData();
  }, []);

  const cards = [
    { label: 'Kunjungan Hari Ini', value: stats.todayVisits, icon: Activity, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Kunjungan Bulan Ini', value: stats.monthVisits, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Pasien Diperiksa (Bulan Ini)', value: stats.uniqueStudents, icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Obat Stok Menipis', value: stats.lowStock, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
  ];

  return (
    <div className="space-y-6 pb-12">
      <header className="flex items-center justify-between bg-white p-4 rounded-lg border border-slate-200 shadow-sm h-16">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-blue-600 rounded-full" />
          <h1 className="text-sm font-bold text-slate-800 tracking-tight uppercase">Dashboard Overview</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right hidden md:block">
            <p className="label-caps">Status Layanan</p>
            <p className="text-[11px] font-bold text-emerald-600 uppercase">Operasional UKS</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded uppercase font-mono">
            <Calendar className="w-3.5 h-3.5" />
            {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <div key={i} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm hover:border-blue-300 transition-colors group">
            <p className="label-caps mb-2">{card.label}</p>
            <div className="flex items-end justify-between">
              <p className="text-2xl font-bold font-mono text-slate-900">{card.value}</p>
              <div className={cn("p-1.5 rounded", card.bg)}>
                <card.icon className={cn("w-4 h-4", card.color)} />
              </div>
            </div>
            <div className="mt-3 h-1 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className={cn("h-full transition-all duration-1000", card.color.replace('text', 'bg'))} style={{ width: '60%' }} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="label-caps">Tren Kunjungan Pekanan</h3>
            <span className="text-[10px] text-slate-400 font-mono tracking-tighter">METRIC_REPORT_7D</span>
          </div>
          <div className="p-4 flex-1">
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} 
                    dy={10}
                  />
                  <YAxis hide />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc', radius: 4 }}
                    contentStyle={{ borderRadius: '4px', border: '1px solid #e2e8f0', fontSize: '10px', padding: '8px' }}
                  />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]} barSize={32}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index === chartData.length - 1 ? '#2563eb' : '#cbd5e1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col">
          <div className="p-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <h3 className="label-caps">Log Aktivitas Terakhir</h3>
            <button 
              onClick={() => setActiveTab('visits')}
              className="text-blue-600 text-[10px] font-bold hover:underline tracking-widest"
            >
              SEMUA
            </button>
          </div>
          <div className="p-2 space-y-1 flex-1 overflow-auto max-h-[340px]">
            {recentVisits.map((v) => (
              <div key={v.id} onClick={() => setActiveTab('visits')} className="flex items-center gap-3 p-3 rounded hover:bg-slate-50 transition-colors cursor-pointer border-b border-transparent hover:border-slate-100">
                <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs uppercase overflow-hidden">
                  {v.studentName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="font-bold text-slate-800 text-xs truncate uppercase tracking-tight">{v.studentName}</p>
                    <span className="text-[9px] font-mono text-slate-400">
                      {new Date(v.date).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1 rounded uppercase tracking-tighter">KLS {v.grade}</span>
                    <p className="text-[10px] text-slate-400 truncate italic">{v.complaint}</p>
                  </div>
                </div>
              </div>
            ))}
            {recentVisits.length === 0 && (
              <p className="text-center text-slate-400 py-12 text-[10px] uppercase font-bold italic tracking-widest">NO_LOGDATA</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
