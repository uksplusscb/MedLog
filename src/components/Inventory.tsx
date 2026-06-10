import React, { useEffect, useState, useRef } from 'react';
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
import { 
  Plus, 
  Minus, 
  Search, 
  Package, 
  Edit2, 
  Trash2, 
  Loader2, 
  AlertCircle, 
  Sparkles, 
  CheckCircle2, 
  Layers, 
  ArrowUpDown,
  X,
  FileEdit,
  RotateCcw
} from 'lucide-react';
import { getCachedDriveToken } from '../lib/drive';
import { fetchMasterDataFromSheets } from '../lib/sheets';

export default function Inventory() {
  const [firestoreMedicines, setFirestoreMedicines] = useState<Medicine[]>([]);
  const [sheetMedicines, setSheetMedicines] = useState<Medicine[]>(() => {
    try {
      const cached = localStorage.getItem('uks_cache_medicines');
      if (cached) {
        const parsed = JSON.parse(cached) as Medicine[];
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  const medicines = React.useMemo(() => {
    const seenNames = new Set<string>();
    const merged: Medicine[] = [];
    
    // 1. Process Firestore medicines first so they have priority on duplicate names
    if (firestoreMedicines && firestoreMedicines.length > 0) {
      firestoreMedicines.forEach(item => {
        if (item && item.name) {
          const key = item.name.trim().toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            merged.push(item);
          }
        }
      });
    }
    
    // 2. Add Google Sheet medicines that are not yet in Firestore
    if (sheetMedicines && sheetMedicines.length > 0) {
      sheetMedicines.forEach(item => {
        if (item && item.name) {
          const key = item.name.trim().toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            merged.push({
              ...item,
              stock: item.stock !== undefined ? item.stock : 0
            });
          }
        }
      });
    }
    
    merged.sort((a, b) => a.name.localeCompare(b.name));
    return merged;
  }, [firestoreMedicines, sheetMedicines]);
  
  // Form controller state
  const [showAddForm, setShowAddForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    stock: '',
    unit: 'Tablet'
  });

  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'medicines'), (snapshot) => {
      const data = snapshot.docs.map(doc => {
        const dObj = doc.data();
        return {
          id: doc.id,
          name: dObj.name || dObj.obat || dObj.nama || 'Tanpa Nama',
          stock: dObj.stock !== undefined ? dObj.stock : (dObj.stok !== undefined ? dObj.stok : 0),
          unit: dObj.unit || 'Pcs'
        } as Medicine;
      });
      // Sort alphabetically by default
      data.sort((a, b) => a.name.localeCompare(b.name));
      setFirestoreMedicines(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'medicines');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Fetch newer medicines from sheets if user has connected Google Sheets
  useEffect(() => {
    const token = getCachedDriveToken();
    if (token) {
      fetchMasterDataFromSheets(token, 'medicines')
        .then((sheetMeds) => {
          if (sheetMeds && sheetMeds.length > 0) {
            setSheetMedicines(sheetMeds);
            localStorage.setItem('uks_cache_medicines', JSON.stringify(sheetMeds));
          }
        })
        .catch(err => {
          console.error("Gagal mendapatkan master data obat langsung dari Google Sheets di Manajemen Obat:", err);
        });
    }
  }, []);

  const handleOpenAdd = () => {
    setIsEditing(false);
    setEditingId(null);
    setFormData({ name: '', stock: '', unit: 'Tablet' });
    setShowAddForm(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleOpenEdit = (medicine: Medicine) => {
    setIsEditing(true);
    setEditingId(medicine.id || null);
    setFormData({
      name: medicine.name,
      stock: String(medicine.stock),
      unit: medicine.unit
    });
    setShowAddForm(true);
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    setIsEditing(false);
    setEditingId(null);
    setFormData({ name: '', stock: '', unit: 'Tablet' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const isSheetId = isEditing && editingId && editingId.startsWith('sheet_row_');
      let targetId = editingId;
      
      if (isSheetId) {
        const targetName = medicines.find(m => m.id === editingId)?.name || '';
        const matchingFirestore = firestoreMedicines.find(fm => fm.name && targetName && fm.name.trim().toLowerCase() === targetName.trim().toLowerCase());
        if (matchingFirestore) {
          targetId = matchingFirestore.id!;
        } else {
          targetId = null; // force write as new if not matched
        }
      }

      if (isEditing && targetId) {
        const medicineRef = doc(db, 'medicines', targetId);
        await updateDoc(medicineRef, {
          name: formData.name.trim(),
          stock: Number(formData.stock),
          unit: formData.unit,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'medicines'), {
          name: formData.name.trim(),
          stock: Number(formData.stock),
          unit: formData.unit,
          updatedAt: serverTimestamp()
        });
      }
      
      setFormData({ name: '', stock: '', unit: 'Tablet' });
      setShowAddForm(false);
      setIsEditing(false);
      setEditingId(null);
      setIsSubmitting(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'medicines');
      setIsSubmitting(false);
    }
  };

  const handleUpdateStock = async (id: string, currentStock: number, change: number) => {
    try {
      const isSheetId = id && id.startsWith('sheet_row_');
      let targetId = id;
      
      const targetMed = medicines.find(m => m.id === id);
      const targetName = targetMed?.name || '';
      
      const matchingFirestore = firestoreMedicines.find(fm => fm.name && targetName && fm.name.trim().toLowerCase() === targetName.trim().toLowerCase());
      
      if (matchingFirestore) {
        targetId = matchingFirestore.id!;
      }
      
      if (isSheetId && !matchingFirestore) {
        // Upsert new document in Firestore for this sheet-derived medicine
        await addDoc(collection(db, 'medicines'), {
          name: targetName,
          stock: Math.max(0, currentStock + change),
          unit: targetMed?.unit || 'Tablet',
          updatedAt: serverTimestamp()
        });
      } else {
        const medicineRef = doc(db, 'medicines', targetId);
        await updateDoc(medicineRef, {
          stock: Math.max(0, currentStock + change),
          updatedAt: serverTimestamp()
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'medicines');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus obat ini dari inventaris?')) return;
    try {
      const isSheetId = id && id.startsWith('sheet_row_');
      let targetId = id;
      
      if (isSheetId) {
        const targetName = medicines.find(m => m.id === id)?.name || '';
        const matchingFirestore = firestoreMedicines.find(fm => fm.name && targetName && fm.name.trim().toLowerCase() === targetName.trim().toLowerCase());
        if (matchingFirestore) {
          targetId = matchingFirestore.id!;
        } else {
          // If only exists in Google Sheets, we show warning
          alert("Obat ini tersimpan di Google Sheets dan tidak dapat dihapus permanen dari aplikasi kecuali dihapus langsung dari file Google Sheet Anda.");
          return;
        }
      }
      await deleteDoc(doc(db, 'medicines', targetId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'medicines');
    }
  };

  // Filtered medicine items
  const filteredMedicines = medicines.filter(med => 
    med.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Statistics calculation
  const totalItems = medicines.length;
  const criticalItems = medicines.filter(med => med.stock < 10).length;
  const outOfStockItems = medicines.filter(med => med.stock === 0).length;

  return (
    <div className="space-y-6">
      {/* Analytics Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Jenis Obat</span>
            <span className="text-2xl font-black text-slate-900 font-mono tracking-tight">{totalItems} <span className="text-xs font-normal text-slate-500">Jenis</span></span>
          </div>
          <div className="bg-blue-50 text-blue-600 p-2.5 rounded-lg">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Stok Menipis (&lt; 10)</span>
            <span className={cn(
              "text-2xl font-black font-mono tracking-tight",
              criticalItems > 0 ? "text-amber-600 animate-pulse" : "text-slate-900"
            )}>
              {criticalItems} <span className="text-xs font-normal text-slate-500">Item</span>
            </span>
          </div>
          <div className={cn(
            "p-2.5 rounded-lg",
            criticalItems > 0 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400"
          )}>
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Stok Kosong</span>
            <span className={cn(
              "text-2xl font-black font-mono tracking-tight",
              outOfStockItems > 0 ? "text-rose-600" : "text-slate-900"
            )}>
              {outOfStockItems} <span className="text-xs font-normal text-slate-500">Item</span>
            </span>
          </div>
          <div className={cn(
            "p-2.5 rounded-lg",
            outOfStockItems > 0 ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-400"
          )}>
            <Package className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main Layout Control Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm gap-4">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 bg-indigo-600 rounded-full" />
          <div>
            <h2 className="text-xs font-black text-slate-800 tracking-wider uppercase">Management Obat &amp; Terapi</h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-tight">Daftar stok obat Unit Kesehatan Sekolah (UKS)</p>
          </div>
        </div>
        
        <div className="flex flex-1 max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="Cari nama obat..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:border-indigo-400 focus:bg-white transition-all text-slate-800 placeholder-slate-400 h-8"
            />
          </div>
          <button
            onClick={() => showAddForm ? handleCancelForm() : handleOpenAdd()}
            className={cn(
              "px-4 py-1.5 rounded text-[10px] font-black tracking-widest uppercase transition-all flex items-center gap-1.5 h-8 cursor-pointer select-none shadow-sm",
              showAddForm 
                ? "bg-slate-150 hover:bg-slate-200 text-slate-700 border border-slate-300"
                : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/10"
            )}
          >
            {showAddForm ? (
              <>
                <X className="w-3.5 h-3.5" />
                Batal
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                Tambah Obat
              </>
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Form for Add and Edit */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div 
            ref={formRef}
            initial={{ opacity: 0, scale: 0.98, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -10 }}
            className="bg-white p-5 rounded-xl border border-indigo-100 shadow-md shadow-indigo-100/10 overflow-hidden"
          >
            <div className="flex justify-between items-center pb-3 border-b border-indigo-50 mb-4">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                {isEditing ? 'Edit Data Obat / Item' : 'Tambah Obat Baru ke Database'}
              </h3>
              <button 
                type="button" 
                onClick={handleCancelForm}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Nama Obat/Item</label>
                <input
                  required
                  type="text"
                  placeholder="Contoh: Paracetamol 500mg"
                  className="input-dense bg-slate-50/50"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Stok Saat Ini</label>
                <input
                  required
                  type="number"
                  min="0"
                  placeholder="0"
                  className="input-dense bg-slate-50/50"
                  value={formData.stock}
                  onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-600 uppercase tracking-wider block">Satuan (Unit)</label>
                <select
                  className="input-dense bg-slate-50/50"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                >
                  <option value="Tablet">Tablet</option>
                  <option value="Kapsul">Kapsul</option>
                  <option value="Botol">Botol</option>
                  <option value="Strip">Strip</option>
                  <option value="Pcs">Pcs</option>
                  <option value="Sachet">Sachet</option>
                  <option value="Salep">Salep</option>
                  <option value="Plester">Plester</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-slate-900 text-white h-8 px-4 rounded font-black text-[10px] hover:bg-slate-800 transition-all disabled:opacity-50 uppercase tracking-widest flex items-center justify-center gap-1.5 cursor-pointer shadow"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" />
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {isEditing ? 'Simpan' : 'Tambah'}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 h-8 px-3 rounded font-black text-[10px] transition-all uppercase tracking-widest flex items-center justify-center cursor-pointer"
                >
                  Batal
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List Output representation */}
      {loading ? (
        <div className="flex justify-center py-12 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-mono">Loading Medicines...</span>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {filteredMedicines.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <Package className="w-12 h-12 text-slate-300 mx-auto animate-bounce" />
              <div className="space-y-1">
                <p className="text-slate-700 font-bold text-xs uppercase tracking-wider">Tidak Ada Obat Ditemukan</p>
                <p className="text-slate-400 text-[10px] uppercase">Coba kata kunci lain atau tambahkan ketersediaan obat baru.</p>
              </div>
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="text-[9px] font-black text-indigo-600 hover:underline uppercase tracking-widest gap-1 flex items-center mx-auto"
                >
                  <RotateCcw className="w-3 h-3" /> Bersihkan Pencarian
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                    <th className="py-3 px-4 text-center w-12">No</th>
                    <th className="py-3 px-4">Nama Obat / Item</th>
                    <th className="py-3 px-4 w-28">Satuan</th>
                    <th className="py-3 px-4 text-center w-28">Sisa Stok</th>
                    <th className="py-3 px-4 w-36">Status</th>
                    <th className="py-3 px-4 text-center w-36">Atur Stok Cepat</th>
                    <th className="py-3 px-4 text-center w-28 text-slate-700 font-black">Tindakan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                  {filteredMedicines.map((med, index) => {
                    const isLow = med.stock < 10;
                    const isOut = med.stock === 0;

                    return (
                      <tr 
                        key={med.id} 
                        className="hover:bg-indigo-50/20 transition-colors group align-middle"
                      >
                        {/* 1. No */}
                        <td className="py-3 px-4 text-center font-mono font-semibold text-slate-400">
                          {index + 1}
                        </td>

                        {/* 2. Nama Obat / Item */}
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-800 text-xs uppercase tracking-tight">{med.name}</span>
                            <span className="text-[8px] font-semibold text-slate-400 font-mono tracking-wider">ID: {med.id?.slice(-8).toUpperCase()}</span>
                          </div>
                        </td>

                        {/* 3. Satuan */}
                        <td className="py-3 px-4">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                            {med.unit}
                          </span>
                        </td>

                        {/* 4. Sisa Stok */}
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-baseline gap-0.5 font-mono">
                            <span className={cn(
                              "text-sm font-black tracking-tight",
                              isOut ? "text-rose-600" : isLow ? "text-amber-600" : "text-slate-900"
                            )}>
                              {med.stock}
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 uppercase">{med.unit}</span>
                          </div>
                        </td>

                        {/* 5. Status */}
                        <td className="py-3 px-4">
                          {isOut ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-rose-50 text-rose-600 border border-rose-100">
                              <span className="w-1 h-1 rounded-full bg-rose-500 animate-ping"></span>
                              Habis
                            </span>
                          ) : isLow ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-amber-50 text-amber-600 border border-amber-100">
                              <span className="w-1 h-1 rounded-full bg-amber-500 animate-pulse"></span>
                              Menipis
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-emerald-50 text-emerald-600 border border-emerald-100">
                              Tersedia
                            </span>
                          )}
                        </td>

                        {/* 6. Atur Stok Cepat */}
                        <td className="py-3 px-4">
                          <div className="flex justify-center items-center gap-1.5">
                            <button 
                              onClick={() => handleUpdateStock(med.id!, med.stock, -1)}
                              className="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-rose-600 hover:border-rose-100 transition-all cursor-pointer box-content shadow-sm"
                              title="Kurangi Stok (1)"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-8 text-center text-[10px] font-bold font-mono bg-slate-50 border border-slate-100 py-0.5 rounded">
                              {med.stock}
                            </span>
                            <button 
                              onClick={() => handleUpdateStock(med.id!, med.stock, 1)}
                              className="w-6 h-6 rounded border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-emerald-600 hover:border-emerald-100 transition-all cursor-pointer box-content shadow-sm"
                              title="Tambah Stok (1)"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        {/* 7. Tindakan */}
                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center justify-center gap-1 text-slate-400">
                            <button 
                              onClick={() => handleOpenEdit(med)}
                              className="w-7 h-7 rounded hover:bg-slate-100 hover:text-indigo-600 flex items-center justify-center transition-colors cursor-pointer"
                              title="Edit Detail Obat"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button 
                              onClick={() => handleDelete(med.id!)}
                              className="w-7 h-7 rounded hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center transition-colors cursor-pointer"
                              title="Hapus"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
