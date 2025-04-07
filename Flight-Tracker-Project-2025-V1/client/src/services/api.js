// client/src/services/api.js
import axios from 'axios';

// Create an axios instance with the new API base URL
const api = axios.create({
  baseURL: '/flight-api',
  headers: {
    'Content-Type': 'application/json',
  }
});

// API endpoints
const endpoints = {
  // Upload endpoints
  uploadCsv: (formData) => api.post('/upload-csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  
  // Flight endpoints
  getFlights: (params) => api.get('/flights', { params }),
  getFlight: (id) => api.get(`/flights/${id}`),
  
  // Dashboard data
  getDashboard: () => api.get('/dashboard'),
  
  // Reports data
  getReports: (timeRange) => api.get('/reports', { params: { timeRange } })
};

export default endpoints;
