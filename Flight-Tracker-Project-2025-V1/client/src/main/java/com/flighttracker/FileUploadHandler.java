package com.flighttracker;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

public class FileUploadHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger(FileUploadHandler.class.getName());
    private final FlightTrackerSimple flightTracker;
    
    public FileUploadHandler(FlightTrackerSimple flightTracker) {
        this.flightTracker = flightTracker;
    }
    
    @Override
    public void handle(HttpExchange exchange) throws IOException {
        LOGGER.info("Received file upload request: " + exchange.getRequestMethod());
        
        // CORS headers
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "POST, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
        
        if ("OPTIONS".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }
        
        if (!"POST".equals(exchange.getRequestMethod())) {
            sendResponse(exchange, 405, "{\"success\":false,\"message\":\"Method not allowed\"}");
            return;
        }
        
        // Log Content-Type header - useful for debugging
        String contentType = exchange.getRequestHeaders().getFirst("Content-Type");
        LOGGER.info("Content-Type: " + contentType);
        
        String tempFilePath = null;
        try {
            // Create temp file
            tempFilePath = System.getProperty("java.io.tmpdir") + "/upload_" + UUID.randomUUID() + ".csv";
            LOGGER.info("Saving uploaded CSV to: " + tempFilePath);
            
            // Save uploaded file directly from request body
            // In a simple HttpServer implementation, we don't have multipart parsing
            // We're assuming the entire body contains the CSV file
            try (InputStream in = exchange.getRequestBody();
                 FileOutputStream out = new FileOutputStream(tempFilePath)) {
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                }
            }
            
            // Debug: Check if file exists and its size
            File tempFile = new File(tempFilePath);
            LOGGER.info("Temp file created: " + tempFile.exists() + ", size: " + tempFile.length() + " bytes");
            
            // Debug: Log the content of the uploaded file
            try (BufferedReader reader = new BufferedReader(new FileReader(tempFilePath))) {
                LOGGER.info("CSV File Content:");
                String line;
                int lineCount = 0;
                while ((line = reader.readLine()) != null && lineCount < 5) {
                    LOGGER.info("Line " + lineCount + ": " + line);
                    lineCount++;
                }
            } catch (Exception e) {
                LOGGER.log(Level.SEVERE, "Error reading uploaded file", e);
            }
            
            // Process CSV with error handling
            boolean success = false;
            try {
                success = flightTracker.processCSV(tempFilePath);
                if (!success) {
                    LOGGER.warning("CSV processing failed - returned false");
                    sendResponse(exchange, 400, "{\"success\":false,\"message\":\"Invalid CSV format - headers may not match expected format\"}");
                    return;
                }
            } catch (Exception e) {
                LOGGER.log(Level.SEVERE, "CSV Processing Error", e);
                sendResponse(exchange, 400, "{\"success\":false,\"message\":\"Error processing CSV: " + e.getMessage() + "\"}");
                return;
            }
            
            LOGGER.info("CSV processing successful");
            sendResponse(exchange, 200, "{\"success\":true,\"message\":\"File processed successfully\"}");
            
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Upload Error", e);
            sendResponse(exchange, 500, "{\"success\":false,\"message\":\"Server error: " + e.getMessage() + "\"}");
        } finally {
            // Clean up temp file
            if (tempFilePath != null) {
                File tempFile = new File(tempFilePath);
                if (tempFile.exists()) {
                    if (tempFile.delete()) {
                        LOGGER.info("Temporary file deleted successfully");
                    } else {
                        LOGGER.warning("Failed to delete temporary file: " + tempFilePath);
                    }
                }
            }
        }
    }
    
    private void sendResponse(HttpExchange exchange, int statusCode, String response) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(statusCode, response.getBytes(StandardCharsets.UTF_8).length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(response.getBytes(StandardCharsets.UTF_8));
        }
    }
}
