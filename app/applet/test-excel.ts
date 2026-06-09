import ExcelJS from 'exceljs';
console.log(ExcelJS ? "Imported ExcelJS properly" : "Failed to import");
console.log(typeof ExcelJS.Workbook === 'function' ? 'Has Workbook function' : 'No Workbook function');
