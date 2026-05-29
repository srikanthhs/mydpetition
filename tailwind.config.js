/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  safelist: [
    'text-indigo-600','text-green-600','text-red-600','text-amber-600',
    'bg-green-500','bg-amber-500','bg-red-500',
    'bg-green-100','bg-red-100','text-green-700','text-red-700',
  ],
  theme: { extend: {} },
  plugins: [],
};
