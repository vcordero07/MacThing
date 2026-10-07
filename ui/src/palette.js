// Flat backgrounds. `font` is the readable ink for that colour; Settings can still flip it.
export const FLAT_COLORS = [
  { id: 'ink', name: 'Black', hex: '#111111', font: 'light' },
  { id: 'snow', name: 'White', hex: '#f3f1ec', font: 'dark' },
  { id: 'red', name: 'Red', hex: '#c44536', font: 'light' },
  { id: 'orange', name: 'Orange', hex: '#e07a2f', font: 'dark' },
  { id: 'gold', name: 'Gold', hex: '#e6b325', font: 'dark' },
  { id: 'green', name: 'Green', hex: '#2f6f4e', font: 'light' },
  { id: 'blue', name: 'Blue', hex: '#1d4e89', font: 'light' },
  { id: 'purple', name: 'Purple', hex: '#5c4d7a', font: 'light' },
];

export const flatColor = (id) => FLAT_COLORS.find((c) => c.id === id);
