// server/app.js - Main application entry point
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const apiRoutes = require('./routes');
const { setupTasks } = require('./tasks');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
mongoose.connect(config.mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('Connected to MongoDB');
  
  // Start scheduled tasks once connected to database
  setupTasks();
})
.catch(err => console.error('MongoDB connection error:', err));

// API Routes
app.use('/api', apiRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// server/config/index.js
module.exports = {
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/flight-tracker',
  flightApiKey: process.env.FLIGHT_API_KEY || 'your-free-api-key',
  flightApiUrl: process.env.FLIGHT_API_URL || 'https://aeroapi.flightaware.com/aeroapi/',
  smsApiKey: process.env.SMS_API_KEY || 'your-sms-api-key',
  notificationPhone: process.env.NOTIFICATION_PHONE || '+1234567890', // This is the phone number you'll provide
  appUrl: process.env.APP_URL || 'http://localhost:5000'
};

// server/models/Flight.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const FlightSchema = new Schema({
  flightNumber: {
    type: String,
    required: true,
    index: true
  },
  airline: {
    type: String,
    required: true
  },
  departureAirport: {
    type: String,
    required: true
  },
  arrivalAirport: {
    type: String,
    required: true
  },
  scheduledDeparture: {
    type: Date,
    required: true,
    index: true
  },
  scheduledArrival: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['Scheduled', 'Delayed', 'Cancelled', 'In Air', 'Landed', 'Unknown'],
    default: 'Scheduled'
  },
  statusHistory: [{
    status: String,
    timestamp: Date
  }],
  delayMinutes: {
    type: Number,
    default: 0
  },
  lastChecked: {
    type: Date
  },
  notificationSent: {
    type: Boolean,
    default: false
  },
  passengers: [{
    type: Schema.Types.ObjectId,
    ref: 'Passenger'
  }],
  archived: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Flight', FlightSchema);

// server/models/Passenger.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PassengerSchema = new Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String
  },
  phone: {
    type: String
  },
  category: {
    type: String,
    enum: ['VIP', 'Business', 'Leisure', 'Frequent Flyer', 'Regular'],
    default: 'Regular'
  },
  flights: [{
    type: Schema.Types.ObjectId,
    ref: 'Flight'
  }],
  archived: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Passenger', PassengerSchema);

// server/models/Batch.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const BatchSchema = new Schema({
  fileName: {
    type: String,
    required: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  processedCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Pending', 'Processing', 'Completed', 'Failed'],
    default: 'Pending'
  },
  flights: [{
    type: Schema.Types.ObjectId,
    ref: 'Flight'
  }],
  passengers: [{
    type: Schema.Types.ObjectId,
    ref: 'Passenger'
  }]
}, { timestamps: true });

module.exports = mongoose.model('Batch', BatchSchema);

// server/routes/index.js - Combine all routes
const express = require('express');
const router = express.Router();

const uploadRoutes = require('./upload');
const flightRoutes = require('./flights');
const reportRoutes = require('./reports');
const dashboardRoutes = require('./dashboard');

router.use('/upload-csv', uploadRoutes);
router.use('/flights', flightRoutes);
router.use('/reports', reportRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;

// server/routes/upload.js - Handle CSV uploads
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const csvService = require('../services/csvService');

// Set up multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads'));
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

router.post('/', upload.single('passengersFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const result = await csvService.processUpload(req.file);
    res.json(result);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

// server/routes/flights.js - Flight status endpoints
const express = require('express');
const router = express.Router();
const Flight = require('../models/Flight');

// Get all flights (with pagination)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;
    
    const query = { archived: { $ne: true } };
    
    // Apply filters if provided
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    if (req.query.airline) {
      query.airline = new RegExp(req.query.airline, 'i');
    }
    
    if (req.query.flightNumber) {
      query.flightNumber = new RegExp(req.query.flightNumber, 'i');
    }
    
    if (req.query.airport) {
      query.$or = [
        { departureAirport: new RegExp(req.query.airport, 'i') },
        { arrivalAirport: new RegExp(req.query.airport, 'i') }
      ];
    }
    
    // Date range filter
    if (req.query.startDate && req.query.endDate) {
      query.scheduledDeparture = {
        $gte: new Date(req.query.startDate),
        $lte: new Date(req.query.endDate)
      };
    }
    
    const flights = await Flight.find(query)
      .sort({ scheduledDeparture: 1 })
      .skip(skip)
      .limit(limit)
      .lean();
      
    const total = await Flight.countDocuments(query);
    
    res.json({
      flights,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching flights:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get flight details with passengers
router.get('/:id', async (req, res) => {
  try {
    const flight = await Flight.findById(req.params.id)
      .populate('passengers', 'name email phone category')
      .lean();
      
    if (!flight) {
      return res.status(404).json({ message: 'Flight not found' });
    }
    
    res.json(flight);
  } catch (error) {
    console.error('Error fetching flight details:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

// server/routes/reports.js - Reporting endpoints
const express = require('express');
const router = express.Router();
const reportService = require('../services/reportService');

router.get('/', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '1m'; // Default to 1 month
    const reports = await reportService.generateReports(timeRange);
    res.json(reports);
  } catch (error) {
    console.error('Error generating reports:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

// server/routes/dashboard.js - Dashboard data
const express = require('express');
const router = express.Router();
const dashboardService = require('../services/dashboardService');

router.get('/', async (req, res) => {
  try {
    const dashboardData = await dashboardService.getDashboardData();
    res.json(dashboardData);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

// server/services/csvService.js - Process uploaded CSV files
const fs = require('fs');
const csv = require('csv-parser');
const Flight = require('../models/Flight');
const Passenger = require('../models/Passenger');
const Batch = require('../models/Batch');

async function processUpload(file) {
  // Create a batch record
  const batch = new Batch({
    fileName: file.originalname,
    status: 'Processing'
  });
  
  await batch.save();
  
  try {
    const rows = await parseCSV(file.path);
    
    // Group passengers by flight
    const flightGroups = {};
    
    for (const row of rows) {
      if (!row.flightNumber || !row.departureDate) {
        continue; // Skip invalid entries
      }
      
      const flightKey = `${row.flightNumber}-${row.departureDate}`;
      
      if (!flightGroups[flightKey]) {
        flightGroups[flightKey] = {
          flightData: {
            flightNumber: row.flightNumber,
            airline: row.airline || 'Unknown',
            departureAirport: row.departureAirport,
            arrivalAirport: row.arrivalAirport,
            scheduledDeparture: parseDateTime(row.departureDate, row.departureTime),
            scheduledArrival: parseDateTime(row.arrivalDate, row.arrivalTime),
            status: 'Scheduled',
            statusHistory: [{
              status: 'Scheduled',
              timestamp: new Date()
            }],
            notificationSent: false
          },
          passengers: []
        };
      }
      
      // Add passenger
      flightGroups[flightKey].passengers.push({
        name: row.passengerName,
        email: row.email,
        phone: row.phone,
        category: determineCategory(row)
      });
    }
    
    // Process each flight group
    const flightIds = [];
    const passengerIds = [];
    
    for (const [flightKey, group] of Object.entries(flightGroups)) {
      // Check if flight already exists
      let flight = await Flight.findOne({
        flightNumber: group.flightData.flightNumber,
        scheduledDeparture: {
          $gte: new Date(group.flightData.scheduledDeparture.getTime() - 1000 * 60 * 10),
          $lte: new Date(group.flightData.scheduledDeparture.getTime() + 1000 * 60 * 10)
        }
      });
      
      if (!flight) {
        flight = new Flight(group.flightData);
        await flight.save();
      }
      
      flightIds.push(flight._id);
      
      // Process passengers
      for (const passengerData of group.passengers) {
        const passenger = new Passenger(passengerData);
        passenger.flights = [flight._id];
        await passenger.save();
        
        passengerIds.push(passenger._id);
        
        // Add passenger reference to flight
        flight.passengers.push(passenger._id);
      }
      
      await flight.save();
    }
    
    // Clean up the uploaded file
    fs.unlinkSync(file.path);
    
    // Update batch record
    batch.flights = flightIds;
    batch.passengers = passengerIds;
    batch.processedCount = passengerIds.length;
    batch.status = 'Completed';
    await batch.save();
    
    return {
      success: true,
      batchId: batch._id,
      flightCount: flightIds.length,
      passengerCount: passengerIds.length
    };
  } catch (error) {
    console.error('Error processing CSV:', error);
    
    // Update batch status
    batch.status = 'Failed';
    await batch.save();
    
    throw new Error(`Failed to process CSV: ${error.message}`);
  }
}

// Helper function to parse CSV
function parseCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

// Helper function to parse date and time
function parseDateTime(dateStr, timeStr) {
  if (!dateStr) return new Date();
  
  const date = new Date(dateStr);
  
  if (timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    date.setHours(hours || 0);
    date.setMinutes(minutes || 0);
  }
  
  return date;
}

// Determine passenger category
function determineCategory(data) {
  if (data.vipStatus === 'true') return 'VIP';
  if (data.travelReason === 'business') return 'Business';
  if (data.travelReason === 'leisure') return 'Leisure';
  if (data.frequentFlyer === 'true') return 'Frequent Flyer';
  return 'Regular';
}

module.exports = {
  processUpload
};

// server/services/flightService.js - Flight status checking
const axios = require('axios');
const Flight = require('../models/Flight');
const Passenger = require('../models/Passenger');
const config = require('../config');
const smsService = require('./smsService');

module.exports = {
  checkFlightStatus,
  sendFlightNotifications
};

// Free flight API - AeroDataBox
const flightApi = axios.create({
  baseURL: 'https://aerodatabox.p.rapidapi.com/flights',
  headers: {
    'X-RapidAPI-Key': config.flightApiKey,
    'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com'
  }
});

async function checkFlightStatus(flight) {
  // Skip already landed or cancelled flights
  if (['Landed', 'Cancelled'].includes(flight.status)) {
    return flight;
  }
  
  // Check if we need to make an API call
  const cacheExpiry = getOptimalCacheExpiry(flight);
  if (flight.lastChecked && (new Date() - flight.lastChecked) < cacheExpiry) {
    return flight; // Use cached data
  }
  
  try {
    // Format date for API (yyyy-MM-dd)
    const departureDate = flight.scheduledDeparture.toISOString().split('T')[0];
    
    // Make API call to get flight status
    const response = await flightApi.get('/number/${flight.flightNumber}/${departureDate}');
    
    // Process the API response
    const apiFlightData = response.data?.flights?.[0];
    
    if (!apiFlightData) {
      console.log(`No data returned for flight ${flight.flightNumber}`);
      return flight;
    }
    
    // Parse API status
    const newStatus = mapApiStatusToInternalStatus(apiFlightData.status);
    const prevStatus = flight.status;
    
    // Calculate delay in minutes if available
    let delayMinutes = 0;
    
    if (apiFlightData.departure?.scheduledTime && apiFlightData.departure?.actualTime) {
      const scheduled = new Date(apiFlightData.departure.scheduledTime);
      const actual = new Date(apiFlightData.departure.actualTime);
      delayMinutes = Math.floor((actual - scheduled) / (1000 * 60));
    }
    
    // Detect status changes that require notification
    const wasDelayedOrCancelled = 
      (newStatus === 'Delayed' && prevStatus !== 'Delayed') || 
      (newStatus === 'Cancelled' && prevStatus !== 'Cancelled');
    
    // Update flight record
    flight.status = newStatus;
    flight.lastChecked = new Date();
    flight.delayMinutes = delayMinutes > 0 ? delayMinutes : 0;
    
    // Add to status history
    flight.statusHistory.push({
      status: newStatus,
      timestamp: new Date()
    });
    
    await flight.save();
    
    // If status changed to delayed or cancelled, send notification
    if (wasDelayedOrCancelled && !flight.notificationSent) {
      await sendFlightNotifications(flight);
      flight.notificationSent = true;
      await flight.save();
    }
    
    return flight;
  } catch (error) {
    console.error(`Error checking status for flight ${flight.flightNumber}:`, error.message);
    return flight;
  }
}

// Helper function to map API status to our internal status
function mapApiStatusToInternalStatus(apiStatus) {
  // Common mappings for flight statuses from APIs
  const statusMap = {
    'scheduled': 'Scheduled',
    'active': 'In Air',
    'en-route': 'In Air',
    'in-air': 'In Air',
    'landed': 'Landed',
    'arrived': 'Landed',
    'cancelled': 'Cancelled',
    'delayed': 'Delayed',
    'diverted': 'Delayed'
  };
  
  // Normalize API status to lowercase for matching
  const normalizedStatus = (apiStatus || '').toLowerCase();
  
  // Find matching status or return Unknown
  for (const [key, value] of Object.entries(statusMap)) {
    if (normalizedStatus.includes(key)) {
      return value;
    }
  }
  
  return 'Unknown';
}

// Determine optimal time between API calls based on flight time
function getOptimalCacheExpiry(flight) {
  const now = new Date();
  const hoursToDeparture = (flight.scheduledDeparture - now) / (1000 * 60 * 60);
  
  // Adaptive polling strategy
  if (hoursToDeparture < 2) return 5 * 60 * 1000;   // 5 minutes if < 2 hours to departure
  if (hoursToDeparture < 6) return 15 * 60 * 1000;  // 15 minutes if < 6 hours
  if (hoursToDeparture < 24) return 30 * 60 * 1000; // 30 minutes if < 24 hours
  return 2 * 60 * 60 * 1000;                        // 2 hours if > 24 hours away
}

// Generate flight status message for passengers
function generateFlightMessage(flight) {
  if (flight.status === 'Delayed') {
    return `Flight Update: Your flight ${flight.flightNumber} from ${flight.departureAirport} to ${flight.arrivalAirport} is delayed by ${flight.delayMinutes} minutes. New departure time: ${formatDateTime(addMinutes(flight.scheduledDeparture, flight.delayMinutes))}.`;
  } else if (flight.status === 'Cancelled') {
    return `Flight Alert: Your flight ${flight.flightNumber} from ${flight.departureAirport} to ${flight.arrivalAirport} scheduled for ${formatDateTime(flight.scheduledDeparture)} has been cancelled. Please contact your airline for rebooking options.`;
  }
}

// Generate admin summary for the main notification phone
function generateAdminSummary(flight, passengerCount) {
  if (flight.status === 'Delayed') {
    return `ALERT: Flight ${flight.flightNumber} (${flight.departureAirport} to ${flight.arrivalAirport}) with ${passengerCount} passengers is delayed by ${flight.delayMinutes} minutes. New departure: ${formatDateTime(addMinutes(flight.scheduledDeparture, flight.delayMinutes))}.`;
  } else if (flight.status === 'Cancelled') {
    return `ALERT: Flight ${flight.flightNumber} (${flight.departureAirport} to ${flight.arrivalAirport}) with ${passengerCount} passengers has been CANCELLED. Originally scheduled for ${formatDateTime(flight.scheduledDeparture)}.`;
  }
}

// Helper function to add minutes to a date
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// Format date and time for messages
function formatDateTime(date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Send notifications for delayed/cancelled flights
async function sendFlightNotifications(flight) {
  try {
    // Get all passengers for this flight
    const passengers = await Passenger.find({ flights: flight._id });
    
    // Prepare message based on flight status
    const message = generateFlightMessage(flight);
    
    // Compose a summary message for the admin (you)
    const adminMessage = generateAdminSummary(flight, passengers.length);
    
    // Send to admin first
    await smsService.sendSMS(config.notificationPhone, adminMessage);
    
    // Then send to each passenger with a phone number
    // For free plan, we'll limit this to just the admin in production
    // For testing, you can enable this if needed
    // for (const passenger of passengers) {
    //   if (passenger.phone) {
    //     await smsService.sendSMS(passenger.phone, message);
    //   }
    // }