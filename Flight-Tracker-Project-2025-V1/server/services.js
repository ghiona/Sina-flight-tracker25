// server/services/smsService.js - SMS notification service
const axios = require('axios');
const config = require('../config');

// For a free SMS service, we'll use TextBelt which offers 1 free text per day
// You could also use a Twilio trial account
async function sendSMS(phoneNumber, message) {
  try {
    // For a completely free option, log the message and simulate sending
    console.log(`SMS to ${phoneNumber}: ${message}`);
    
    // For development/demo purposes:
    return { success: true, simulated: true };
    
    // For production with TextBelt (1 free SMS per day):
    /*
    const response = await axios.post('https://textbelt.com/text', {
      phone: phoneNumber,
      message: message,
      key: 'textbelt'  // Free tier: one text per day
    });
    
    return response.data;
    */
    
    // For production with Twilio:
    /*
    const accountSid = config.twilioAccountSid;
    const authToken = config.twilioAuthToken;
    const client = require('twilio')(accountSid, authToken);
    
    const result = await client.messages.create({
      body: message,
      from: config.twilioPhoneNumber,
      to: phoneNumber
    });
    
    return { success: true, sid: result.sid };
    */
  } catch (error) {
    console.error('SMS sending error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendSMS
};

// server/services/dashboardService.js - Dashboard data service
const Flight = require('../models/Flight');
const Passenger = require('../models/Passenger');
const Batch = require('../models/Batch');

async function getDashboardData() {
  try {
    // Get flight statistics
    const flightStats = await getFlightStats();
    
    // Get passenger statistics
    const passengerStats = await getPassengerStats();
    
    // Get recent uploads
    const recentUploads = await Batch.find()
      .sort({ uploadDate: -1 })
      .limit(5)
      .lean();
    
    // Get upcoming flights (next 24 hours)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(now.getHours() + 24);
    
    const upcomingFlights = await Flight.find({
      scheduledDeparture: { $gte: now, $lte: tomorrow },
      status: { $nin: ['Landed', 'Cancelled'] }
    })
    .sort({ scheduledDeparture: 1 })
    .limit(10)
    .lean();
    
    return {
      flightStats,
      passengerStats,
      recentUploads,
      upcomingFlights
    };
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    throw error;
  }
}

async function getFlightStats() {
  const total = await Flight.countDocuments({ archived: { $ne: true } });
  const scheduled = await Flight.countDocuments({ status: 'Scheduled', archived: { $ne: true } });
  const inAir = await Flight.countDocuments({ status: 'In Air', archived: { $ne: true } });
  const delayed = await Flight.countDocuments({ status: 'Delayed', archived: { $ne: true } });
  const cancelled = await Flight.countDocuments({ status: 'Cancelled', archived: { $ne: true } });
  const landed = await Flight.countDocuments({ status: 'Landed', archived: { $ne: true } });
  
  return {
    total,
    scheduled,
    inAir,
    delayed,
    cancelled,
    landed
  };
}

async function getPassengerStats() {
  const total = await Passenger.countDocuments({ archived: { $ne: true } });
  
  const categoryResults = await Passenger.aggregate([
    { $match: { archived: { $ne: true } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);
  
  const byCategory = categoryResults.map(item => ({
    category: item._id,
    count: item.count
  }));
  
  return {
    total,
    byCategory
  };
}

module.exports = {
  getDashboardData
};

// server/services/reportService.js - Generate reports
const Flight = require('../models/Flight');
const Passenger = require('../models/Passenger');
const { addDays, subMonths, subDays, format } = require('date-fns');

async function generateReports(timeRange) {
  try {
    // Determine date range
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case '1m':
        startDate = subMonths(now, 1);
        break;
      case '3m':
        startDate = subMonths(now, 3);
        break;
      default:
        startDate = subMonths(now, 1);
    }
    
    // Fetch data for reports
    const [
      flightsByStatus,
      flightsByAirline,
      passengersByCategory,
      delayTrend
    ] = await Promise.all([
      getFlightsByStatus(startDate, now),
      getFlightsByAirline(startDate, now),
      getPassengersByCategory(startDate, now),
      getDelayTrend(startDate, now)
    ]);
    
    return {
      flightsByStatus,
      flightsByAirline,
      passengersByCategory,
      delayTrend
    };
  } catch (error) {
    console.error('Error generating reports:', error);
    throw error;
  }
}

// Get flights by status
async function getFlightsByStatus(startDate, endDate) {
  const results = await Flight.aggregate([
    {
      $match: {
        scheduledDeparture: { $gte: startDate, $lte: endDate },
        archived: { $ne: true }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  // Format for the chart
  return results.map(item => ({
    name: item._id || 'Unknown',
    value: item.count
  }));
}

// Get flights by airline
async function getFlightsByAirline(startDate, endDate) {
  const results = await Flight.aggregate([
    {
      $match: {
        scheduledDeparture: { $gte: startDate, $lte: endDate },
        archived: { $ne: true }
      }
    },
    {
      $group: {
        _id: '$airline',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    },
    {
      $limit: 10 // Top 10 airlines
    }
  ]);
  
  // Format for the chart
  return results.map(item => ({
    name: item._id || 'Unknown',
    value: item.count
  }));
}

// Get passengers by category
async function getPassengersByCategory(startDate, endDate) {
  // We'll get all passengers from flights in the given date range
  const flightIds = await Flight.find({
    scheduledDeparture: { $gte: startDate, $lte: endDate },
    archived: { $ne: true }
  }).distinct('_id');
  
  const results = await Passenger.aggregate([
    {
      $match: {
        flights: { $in: flightIds },
        archived: { $ne: true }
      }
    },
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  // Format for the chart
  return results.map(item => ({
    name: item._id || 'Regular',
    value: item.count
  }));
}

// Get delay trend (daily count of delayed and cancelled flights)
async function getDelayTrend(startDate, endDate) {
  // Create array of days in the range
  const days = [];
  let currentDay = new Date(startDate);
  
  while (currentDay <= endDate) {
    days.push(new Date(currentDay));
    currentDay = addDays(currentDay, 1);
  }
  
  // Get delayed flights by day
  const delayedResults = await Flight.aggregate([
    {
      $match: {
        scheduledDeparture: { $gte: startDate, $lte: endDate },
        status: 'Delayed',
        archived: { $ne: true }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$scheduledDeparture' },
          month: { $month: '$scheduledDeparture' },
          day: { $dayOfMonth: '$scheduledDeparture' }
        },
        count: { $sum: 1 }
      }
    }
  ]);
  
  // Get cancelled flights by day
  const cancelledResults = await Flight.aggregate([
    {
      $match: {
        scheduledDeparture: { $gte: startDate, $lte: endDate },
        status: 'Cancelled',
        archived: { $ne: true }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$scheduledDeparture' },
          month: { $month: '$scheduledDeparture' },
          day: { $dayOfMonth: '$scheduledDeparture' }
        },
        count: { $sum: 1 }
      }
    }
  ]);
  
  // Map results to days
  return days.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const displayDate = format(day, 'MMM d');
    
    // Find delayed count for this day
    const delayedItem = delayedResults.find(item => 
      item._id.year === day.getFullYear() && 
      item._id.month === day.getMonth() + 1 && 
      item._id.day === day.getDate()
    );
    
    // Find cancelled count for this day
    const cancelledItem = cancelledResults.find(item => 
      item._id.year === day.getFullYear() && 
      item._id.month === day.getMonth() + 1 && 
      item._id.day === day.getDate()
    );
    
    return {
      date: displayDate,
      fullDate: dateStr,
      delayedFlights: delayedItem ? delayedItem.count : 0,
      cancelledFlights: cancelledItem ? cancelledItem.count : 0
    };
  });
}

module.exports = {
  generateReports
};

// server/tasks/index.js - Scheduled tasks
const flightService = require('../services/flightService');
const Flight = require('../models/Flight');

function setupTasks() {
  // Set up periodic flight status checks
  setupFlightStatusChecks();
  
  // Set up data cleanup for flights older than 3 months
  setupDataCleanup();
}

// Check flight statuses periodically
function setupFlightStatusChecks() {
  // Run every minute to check flights that need updating
  setInterval(async () => {
    try {
      // Get active flights (not landed or cancelled)
      const activeFlights = await Flight.find({
        status: { $nin: ['Landed', 'Cancelled'] },
        scheduledDeparture: { $gte: new Date(Date.now() - (24 * 60 * 60 * 1000)) } // Within last 24 hours
      });
      
      console.log(`Checking status for ${activeFlights.length} active flights`);
      
      // Group by airline and check status
      // This helps with API rate limits
      const flightsByAirline = {};
      
      activeFlights.forEach(flight => {
        if (!flightsByAirline[flight.airline]) {
          flightsByAirline[flight.airline] = [];
        }
        flightsByAirline[flight.airline].push(flight);
      });
      
      // Process each airline group with small delays between API calls
      for (const [airline, flights] of Object.entries(flightsByAirline)) {
        for (const flight of flights) {
          await flightService.checkFlightStatus(flight);
          
          // Add small delay between API calls to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error('Error in scheduled flight status check:', error);
    }
  }, 60 * 1000); // Run every minute
}

// Clean up old data periodically
function setupDataCleanup() {
  // Run once a day
  setInterval(async () => {
    try {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      
      // Mark flights older than 3 months as archived
      const flightResult = await Flight.updateMany(
        { scheduledDeparture: { $lt: threeMonthsAgo } },
        { $set: { archived: true } }
      );
      
      console.log(`Archived ${flightResult.nModified} old flights`);
      
      // Also archive passengers that only have archived flights
      const activeFlightIds = await Flight.find(
        { archived: { $ne: true } }
      ).distinct('_id');
      
      const passengerResult = await Passenger.updateMany(
        { 
          flights: { $not: { $elemMatch: { $in: activeFlightIds } } },
          archived: { $ne: true }
        },
        { $set: { archived: true } }
      );
      
      console.log(`Archived ${passengerResult.nModified} old passenger records`);
    } catch (error) {
      console.error('Error in data cleanup task:', error);
    }
  }, 24 * 60 * 60 * 1000); // Run once per day
}

module.exports = {
  setupTasks
};
