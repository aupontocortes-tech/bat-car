import * as XLSX from 'xlsx';
import type { PlateRecord } from '../../utils/plate';

function buildWorkbook(records: PlateRecord[]) {
  const arr = Array.isArray(records) ? records : [];
  const rows = arr.map((r) => ({ Placa: r.plate, 'Data e hora': new Date(r.timestamp).toLocaleString() }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Placas');
  return wb;
}

export function downloadExcel(records: PlateRecord[], filename = 'placas_batapp.xlsx') {
  const wb = buildWorkbook(records);
  XLSX.writeFile(wb, filename);
}

export async function makeExcelBlob(records: PlateRecord[]): Promise<Blob> {
  const wb = buildWorkbook(records);
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}