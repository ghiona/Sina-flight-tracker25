const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const notificationService = require('./services/notificationService');

// Create Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Data storage path
const DATA_PATH = path.join(__dirname, 'data');
const FLIGHTS_FILE = path.join(DATA_PATH, 'flights.json');
const REPORTS_FILE = path.join(DATA_PATH, 'reports.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_PATH)) {
  fs.mkdirSync(DATA_PATH, { recursive: true });
}

// Initialize empty data files if they don't exist
if (!fs.existsSync(FLIGHTS_FILE)) {
  fs.writeFileSync(FLIGHTS_FILE, JSON.stringify({ flights: {} }));
}
if (!fs.existsSync(REPORTS_FILE)) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify({
    flightsByStatus: [
      { name: 'Scheduled', value: 0 },
      { name: 'Delayed', value: 0 },
      { name: 'Cancelled', value: 0 },
      { name: 'In Air', value: 0 },
      { name: 'Landed', value: 0 }
    ],
    flightsByAirline: [],
    passengersByCategory: [
      { name: 'VIP', value: 0 },
      { name: 'Business', value: 0 },
      { name: 'Leisure', value: 0 },
      { name: 'Frequent Flyer', value: 0 },
      { name: 'Regular', value: 0 }
    ],
    delayTrend: []
  }));
}

// Configure storage for uploaded files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      return cb(new Error('Only CSV files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple dashboard endpoint for testing
app.get('/api/dashboard', (req, res) => {
  try {
    // Read flights data to provide summary stats
    const flightsData = JSON.parse(fs.readFileSync(FLIGHTS_FILE, 'utf8'));
    const flightCount = Object.keys(flightsData.flights).length;
    
    // Count passengers
    let passengerCount = 0;
    Object.values(flightsData.flights).forEach(flight => {
      passengerCount += flight.passengers.length;
    });
    
    res.json({ 
      status: 'running',
      serverTime: new Date().toISOString(),
      message: 'Flight Tracker API is operational',
      stats: {
        flightCount,
        passengerCount
      }
    });
  } catch (error) {
    res.json({ 
      status: 'running',
      serverTime: new Date().toISOString(),
      message: 'Flight Tracker API is operational',
      stats: {
        flightCount: 0,
        passengerCount: 0
      }
    });
  }
});

// CSV Upload endpoint
app.post('/api/upload-csv', upload.single('passengersFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }
    
    // Process CSV file
    const results = [];
    const filePath = req.file.path;
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        // Group passengers by flight
        const flights = {};
        
        results.forEach(passenger => {
          const flightKey = `${passenger.flightNumber}-${passenger.departureDate}`;
          
          if (!flights[flightKey]) {
            // Generate random status for demo purposes
            const statusOptions = ['Scheduled', 'Delayed', 'In Air', 'Landed', 'Cancelled'];
            const randomStatus = statusOptions[Math.floor(Math.random() * statusOptions.length)];
            
            flights[flightKey] = {
              flightNumber: passenger.flightNumber,
              airline: passenger.airline,
              departureAirport: passenger.departureAirport,
              arrivalAirport: passenger.arrivalAirport,
              departureDate: passenger.departureDate,
              departureTime: passenger.departureTime,
              arrivalDate: passenger.arrivalDate,
              arrivalTime: passenger.arrivalTime,
              status: randomStatus,
              delayMinutes: randomStatus === 'Delayed' ? Math.floor(Math.random() * 120) + 15 : 0,
              passengers: []
            };
          }
          
          // Determine passenger category
          let category = 'Regular';
          if (passenger.vipStatus === 'true') category = 'VIP';
          else if (passenger.travelReason === 'business') category = 'Business';
          else if (passenger.travelReason === 'leisure') category = 'Leisure';
          else if (passenger.frequentFlyer === 'true') category = 'Frequent Flyer';
          
          flights[flightKey].passengers.push({
            name: passenger.passengerName,
            email: passenger.email,
            phone: passenger.phone,
            travelReason: passenger.travelReason,
            category: category,
            vipStatus: passenger.vipStatus === 'true',
            frequentFlyer: passenger.frequentFlyer === 'true'
          });
        });
        
        // Save processed data to flights.json
        try {
          const existingData = JSON.parse(fs.readFileSync(FLIGHTS_FILE, 'utf8'));
          
          // Merge new flights with existing flights
          const updatedFlights = {
            ...existingData.flights,
            ...flights
          };
          
          fs.writeFileSync(FLIGHTS_FILE, JSON.stringify({ flights: updatedFlights }, null, 2));
        } catch (error) {
          console.error('Error saving flight data:', error);
          fs.writeFileSync(FLIGHTS_FILE, JSON.stringify({ flights }, null, 2));
        }
        
        // Send notifications for delayed or cancelled flights
        let notifiedFlights = 0;
        
        for (const [flightKey, flight] of Object.entries(flights)) {
          if (flight.status === 'Delayed' || flight.status === 'Cancelled') {
            // Generate notification message
            const subject = flight.status === 'Delayed' ? 
              `Flight ${flight.flightNumber} Delayed` : 
              `Flight ${flight.flightNumber} Cancelled`;
            
            const message = flight.status === 'Delayed' ?
              `Flight ${flight.flightNumber} from ${flight.departureAirport} to ${flight.arrivalAirport} on ${flight.departureDate} is delayed by ${flight.delayMinutes} minutes. New departure time: ${formatTime(flight.departureTime, flight.delayMinutes)}.` :
              `Flight ${flight.flightNumber} from ${flight.departureAirport} to ${flight.arrivalAirport} on ${flight.departureDate} has been CANCELLED. It was originally scheduled for ${flight.departureTime}.`;
            
            // Send notification
            await notificationService.sendNotification(null, subject, message);
            notifiedFlights++;
          }
        }
        
        // Generate reports based on all flight data
        try {
          const flightsData = JSON.parse(fs.readFileSync(FLIGHTS_FILE, 'utf8'));
          const allFlights = flightsData.flights;
          
          // Count flights by status
          const statusCounts = {
            'Scheduled': 0,
            'Delayed': 0,
            'Cancelled': 0,
            'In Air': 0,
            'Landed': 0
          };
          
          // Count flights by airline
          const airlineCounts = {};
          
          // Count passengers by category
          const categoryCounts = {
            'VIP': 0,
            'Business': 0,
            'Leisure': 0,
            'Frequent Flyer': 0,
            'Regular': 0
          };
          
          // Generate delay trend (simplified)
          const delayTrend = [];
          const today = new Date();
          
          // Populate last 7 days for delay trend
          for (let i = 6; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            
            delayTrend.push({
              date: dateStr,
              delayedFlights: 0,
              cancelledFlights: 0
            });
          }
          
          // Process flight data for reports
          Object.values(allFlights).forEach(flight => {
            // Count by status
            if (statusCounts.hasOwnProperty(flight.status)) {
              statusCounts[flight.status]++;
            }
            
            // Count by airline
            if (!airlineCounts[flight.airline]) {
              airlineCounts[flight.airline] = 0;
            }
            airlineCounts[flight.airline]++;
            
            // Count passengers by category
            flight.passengers.forEach(passenger => {
              if (categoryCounts.hasOwnProperty(passenger.category)) {
                categoryCounts[passenger.category]++;
              }
            });
            
            // Add to delay trend if recently delayed or cancelled
            const departureDate = new Date(flight.departureDate);
            const daysDiff = Math.floor((today - departureDate) / (1000 * 60 * 60 * 24));
            
            if (daysDiff >= 0 && daysDiff < 7) {
              const trendIndex = 6 - daysDiff;
              
              if (flight.status === 'Delayed') {
                delayTrend[trendIndex].delayedFlights++;
              }
              if (flight.status === 'Cancelled') {
                delayTrend[trendIndex].cancelledFlights++;
              }
            }
          });
          
          // Format report data
          const reports = {
            flightsByStatus: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
            flightsByAirline: Object.entries(airlineCounts).map(([name, value]) => ({ name, value })),
            passengersByCategory: Object.entries(categoryCounts).map(([name, value]) => ({ name, value })),
            delayTrend
          };
          
          // Save reports
          fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2));
        } catch (error) {
          console.error('Error generating reports:', error);
        }
        
        // Clean up the original CSV file
        fs.unlinkSync(filePath);
        
        res.json({
          success: true,
          passengerCount: results.length,
          flightCount: Object.keys(flights).length,
          notifiedFlights,
          message: 'CSV uploaded and processed successfully'
        });
      })
      .on('error', (error) => {
        console.error('Error processing CSV:', error);
        res.status(500).json({ success: false, message: 'Error processing CSV file' });
      });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get reports endpoint
app.get('/api/reports', (req, res) => {
  try {
    const reportsData = JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf8'));
    res.json(reportsData);
  } catch (error) {
    console.error('Error retrieving reports:', error);
    res.status(500).json({ error: 'Failed to retrieve reports' });
  }
});

// Notification Configuration endpoints
app.get('/api/notifications/config', (req, res) => {
  try {
    const config = notificationService.getConfig();
    res.json(config);
  } catch (error) {
    console.error('Error retrieving notification config:', error);
    res.status(500).json({ error: 'Failed to retrieve notification configuration' });
  }
});

app.post('/api/notifications/config', (req, res) => {
  try {
    const success = notificationService.updateConfig(req.body);
    if (success) {
      res.json({ success: true, message: 'Notification configuration updated successfully' });
    } else {
      res.status(500).json({ success: false, message: 'Failed to update notification configuration' });
    }
  } catch (error) {
    console.error('Error updating notification config:', error);
    res.status(500).json({ error: 'Failed to update notification configuration' });
  }
});

app.get('/api/notifications/history', (req, res) => {
  try {
    const history = notificationService.getMessageHistory();
    res.json(history);
  } catch (error) {
    console.error('Error retrieving notification history:', error);
    res.status(500).json({ error: 'Failed to retrieve notification history' });
  }
});

app.post('/api/notifications/test', async (req, res) => {
  try {
    const { message } = req.body;
    const testMessage = message || 'This is a test notification from the Flight Tracker system.';
    
    const result = await notificationService.sendNotification(
      null, 
      'Test Notification', 
      testMessage
    );
    
    if (result.success) {
      res.json({ success: true, message: 'Test notification sent successfully', result });
    } else {
      res.status(500).json({ success: false, message: 'Failed to send test notification', result });
    }
  } catch (error) {
    console.error('Error sending test notification:', error);
    res.status(500).json({ error: 'Failed to send test notification' });
  }
});

// Helper function to format time with delay
function formatTime(timeStr, delayMinutes) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  let totalMinutes = hours * 60 + minutes + delayMinutes;
  
  const newHours = Math.floor(totalMinutes / 60) % 24;
  const newMinutes = totalMinutes % 60;
  
  return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
