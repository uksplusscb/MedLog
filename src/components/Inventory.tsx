import React, { useEffect, useState } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc,
  serverTimestamp 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { Medicine } from '../types';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Minus, Search, Package, Edit2, Trash2, Loader2, AlertCircle, TrendingDown } from 'lucide-react';

export default function Inventory() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    stock: '',
    unit: 'Tablet'
  });

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Medicine));
      setMedicines(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'medicines');
    });

    return () => unsubscribe();
  }, []);

  const handleAddMedicine = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      addDoc(collection(db, 'medicines'), {
        name: formData.name,
        stock: Number(formData.stock),
        unit: formData.unit,
        updatedAt: serverTimestamp()
      }).catch(err => {
        handleFirestoreError(err, OperationType.WRITE, 'medicines');
      });
      
      setFormData({ name: '', stock: '', unit: 'Tablet' });
      setShowAddForm(false);
      setIsSubmitting(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'medicines');
      setIsSubmitting(false);
    }
  };

  const handleUpdateStock = (id: string, currentStock: number, change: number) => {
    try {
      const medicineRef = doc(db, 'medicines', id);
      updateDoc(medicineRef, {
        stock: Math.max(0, currentStock + change),
        updatedAt: serverTimestamp()
      }).catch(err => {
        handleFirestoreError(err, OperationType.UPDATE, 'medicines');
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'medicines');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus obat ini dari inventaris?')) return;
    try {
      await deleteDoc(doc(db, 'medicines', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'medicines');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-lg border border-slate-200 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-blue-600 rounded-full" />
          <h2 className="text-sm font-bold text-slate-800 tracking-tight uppercase">Manajemen Inventaris Obat</h2>
        </div>
        
        <div className="flex flex-1 max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="CARI NAMA OBAT..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:border-blue-300 transition-colors"
            />
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-[10px] font-bold transition-all shadow-sm shadow-blue-600/10 flex items-center gap-2 uppercase tracking-widest flex-shrink-0"
          >
            {showAddForm ? 'BATAL' : (
              <>
                <Plus className="w-3.5 h-3.5" />
                TAMBAH ITEM
              </>
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showAddForm && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm overflow-hidden"
          >
            <form onSubmit={handleAddMedicine} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Nama Obat/Item</label>
                <input
                  required
                  type="text"
                  placeholder="Paracetamol"
                  className="input-dense"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Stok Awal</label>
                <input
                  required
                  type="number"
                  placeholder="0"
                  className="input-dense"
                  value={formData.stock}
                  onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase">Unit Satuan</label>
                <select
                  className="input-dense"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                >
                  <option value="Tablet">Tablet</option>
                  <option value="Kapsul">Kapsul</option>
                  <option value="Botol">Botol</option>
                  <option value="Strip">Strip</option>
                  <option value="Pcs">Pcs</option>
                </select>
              </div>
              <button
                disabled={isSubmitting}
                className="bg-slate-900 text-white h-8 px-6 rounded font-bold text-[10px] hover:bg-slate-800 transition-all disabled:opacity-50 uppercase tracking-widest"
              >
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'SAVE_RECORD'}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {medicines
            .filter(med => med.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .map((med) => (
            <div key={med.id} className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:border-blue-300 transition-colors">
              <div className="p-3 border-b border-slate-50 flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-400 font-mono">ITEM_ID: {med.id?.slice(-4).toUpperCase()}</span>
                <button 
                  onClick={() => handleDelete(med.id!)}
                  className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              
              <div className="p-4 flex-1">
                <h3 className="font-bold text-slate-800 text-xs mb-1 uppercase tracking-tight">{med.name}</h3>
                <p className="text-slate-400 text-[10px] font-medium uppercase">{med.unit}</p>
                
                <div className="mt-4 flex items-center justify-between bg-slate-50 p-2.5 rounded">
                  <div className="flex items-baseline gap-1">
                    <span className={cn(
                      "text-xl font-bold font-mono tracking-tighter",
                      med.stock < 10 ? "text-red-600" : "text-slate-900"
                    )}>
                      {med.stock}
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase">{med.unit}</span>
                  </div>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => handleUpdateStock(med.id!, med.stock, -1)}
                      className="w-7 h-7 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-400 hover:text-red-600 hover:border-red-100 transition-colors"
                      title="Kurangi Stok"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => handleUpdateStock(med.id!, med.stock, 1)}
                      className="w-7 h-7 rounded border border-slate-200 bg-white flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-100 transition-colors"
                      title="Tambah Stok"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {med.stock < 10 && (
                  <div className="mt-3 flex items-center gap-1.5 text-[9px] font-bold text-red-600 bg-red-50 py-1 px-2 rounded uppercase italic">
                    <AlertCircle className="w-3 h-3" />
                    Critically Low Stock
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
