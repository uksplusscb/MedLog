export interface Visit {
  id?: string;
  date: string;
  studentName: string;
  age: number;
  grade: string;
  gender: 'Laki-laki' | 'Perempuan';
  complaint: string;
  bloodPressure: string;
  weight: number;
  temperature: number;
  diagnosis: string;
  therapy: string;
  action: string;
  teacherName?: string;
  teacherWhatsApp?: string;
  supervisorName?: string;
  supervisorWhatsApp?: string;
  parentName?: string;
  parentWhatsApp?: string;
  whatsapp_sent?: boolean;
  whatsapp_sent_at?: string;
  whatsapp_status?: 'pending' | 'success' | 'failed';
  createdAt: any;
  updatedAt: any;
  authorId: string;
  labPhoto?: string;
  labPhotos?: string[];
  nis?: string;
  asrama?: string;
}

export interface Medicine {
  id?: string;
  name: string;
  stock: number;
  unit: string;
  price?: number; // Harga Satuan
}

export interface MedicineMonthlyData {
  id?: string;
  medicineId: string;
  year: number;
  month: number;
  initialStock: number;
  received: number;
  price: number;
}

export interface MedicineLog {
  id?: string;
  medicineId: string;
  medicineName: string;
  quantity: number;
  visitId?: string;
  date: string;
  type: 'OUT' | 'IN';
}

export interface TeacherContact {
  id?: string;
  name: string;
  whatsapp: string;
}

export interface StudentPermit {
  id?: string;
  studentName: string;
  grade: string;
  gender: string;
  date: string; // yyyy-MM-dd
  checkoutTime: string; // HH:mm
  complaint: string;
  status: 'Menunggu Penjemputan' | 'Dalam Perjalanan' | 'Sampai di Rumah';
  additionalNotes: string;
  createdAt: any;
  returnDate?: string; // yyyy-MM-dd
  penjemput?: string;
  
  waliKelas?: string;
  waWaliKelas?: string;
  pembina?: string;
  waPembina?: string;
  
  deliveryStatus?: 'Belum Dikirim' | 'Sedang Mengirim' | 'Berhasil' | 'Gagal';
  deliveryTime?: string;
  deliveryTarget?: string;
  deliveryError?: string;
}

