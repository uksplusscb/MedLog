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
  supervisorName?: string;
  createdAt: any;
  updatedAt: any;
  authorId: string;
}

export interface Medicine {
  id?: string;
  name: string;
  stock: number;
  unit: string;
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
