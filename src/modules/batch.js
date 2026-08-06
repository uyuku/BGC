import * as XLSX from 'xlsx';

export function downloadSampleTemplate(type = 'simple') {
  let sampleData = [];
  let filename = '';

  if (type === 'detailed') {
    sampleData = [
      ['departure_country', 'departure_city', 'arrival_country', 'arrival_city', 'km', 'sea_km', 'road_km'],
      ['Germany', 'Hamburg', 'Turkey', 'Istanbul', '', '', ''],
      ['United Kingdom', 'London', 'United States', 'New York', '', '', '']
    ];
    filename = 'distance_template_detailed.xlsx';
  } else {
    sampleData = [
      ['departure', 'arrival', 'km', 'sea_km', 'road_km'],
      ['Hamburg, Germany', 'Istanbul, Turkey', '', '', ''],
      ['London, UK', 'New York, USA', '', '', '']
    ];
    filename = 'distance_template_simple.xlsx';
  }

  const ws = XLSX.utils.aoa_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Routes');
  XLSX.writeFile(wb, filename);
}