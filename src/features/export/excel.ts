import * as XLSX from 'xlsx';
import type { PlateRecord } from '../../utils/plate';

function buildWorkbook(records: PlateRecord[]) {
  const arr = Array.isArray(records) ? records.filter(Boolean) : [];
  const wb = XLSX.utils.book_new();
  let ws: XLSX.WorkSheet;
  if (arr.length > 0) {
    const rows = arr.map((r) => ({ Placa: r.plate, 'Data e hora': new Date(r.timestamp).toLocaleString() }));
    ws = XLSX.utils.json_to_sheet(rows);
  } else {
    // Fallback robusto: cria planilha com cabeçalho vazio para evitar paths internos que assumem arrays
    ws = XLSX.utils.aoa_to_sheet([[ 'Placa', 'Data e hora' ]]);
  }
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