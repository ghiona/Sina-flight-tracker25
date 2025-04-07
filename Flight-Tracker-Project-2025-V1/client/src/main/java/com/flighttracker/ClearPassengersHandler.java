package com.flighttracker;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.IOException;
import java.io.OutputStream;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * Handler for clearing all passenger data
 */
public class ClearPassengersHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger(ClearPassengersHandler.class.getName());
    private static final String DB_URL = "jdbc:sqlite:flight_tracker.db";
    
    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try {
            if (!"POST".equals(exchange.getRequestMethod())) {
                sendResponse(exchange, 405, "{\"success\":false,\"message\":\"Method not allowed\"}");
                return;
            }
            
            // Clear all passenger and flight status data
            boolean success = clearAllData();
            
            if (success) {
                sendResponse(exchange, 200, "{\"success\":true,\"message\":\"All passenger data cleared successfully\"}");
            } else {
                sendResponse(exchange, 500, "{\"success\":false,\"message\":\"Error clearing passenger data\"}");
            }
            
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Error clearing passenger data", e);
            sendResponse(exchange, 500, "{\"success\":false,\"message\":\"Internal server error\"}");
        }
    }
    
    /**
     * Clear all passenger and flight status data from the database
     */
    private boolean clearAllData() {
        try (Connection conn = DriverManager.getConnection(DB_URL);
             Statement stmt = conn.createStatement()) {
            
            // Delete all flight status records first (due to foreign key constraint)
            stmt.execute("DELETE FROM flight_status");
            
            // Then delete all passenger records
            stmt.execute("DELETE FROM passengers");
            
            LOGGER.info("All passenger data cleared successfully");
            return true;
            
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Error clearing passenger data", e);
            return false;
        }
    }
    
    /**
     * Send HTTP response
     */
    private void sendResponse(HttpExchange exchange, int statusCode, String response) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(statusCode, response.length());
        
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(response.getBytes());
        }
    }
}