package com.flighttracker;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.logging.Level;
import java.util.logging.Logger;

public class FlightTrackerApi {
    private static final Logger LOGGER = Logger.getLogger(FlightTrackerApi.class.getName());
    private static final String DB_URL = "jdbc:sqlite:flight_tracker.db";
    private static final int PORT = 8888;

    public static void startApiServer(FlightTrackerSimple tracker) {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
            server.createContext("/api/flights", new FlightsHandler());
            server.createContext("/api/upload", new FileUploadHandler(tracker));
            server.createContext("/api/passengers/clear", new ClearHandler());
            server.setExecutor(null);
            server.start();
            LOGGER.info("API server started on port " + PORT);
            System.out.println("API server started on port " + PORT);
        } catch (IOException e) {
            LOGGER.log(Level.SEVERE, "Failed to start API server", e);
            System.err.println("Failed to start API server: " + e.getMessage());
        }
    }

    static class FlightsHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("GET".equals(exchange.getRequestMethod())) {
                try {
                    String response = getFlightsJson();
                    
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, response.length());
                    
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(response.getBytes());
                    }
                } catch (Exception e) {
                    LOGGER.log(Level.SEVERE, "Error handling request", e);
                    String response = "{\"error\": \"Internal server error\"}";
                    exchange.sendResponseHeaders(500, response.length());
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(response.getBytes());
                    }
                }
            } else {
                String response = "{\"error\": \"Method not allowed\"}";
                exchange.sendResponseHeaders(405, response.length());
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(response.getBytes());
                }
            }
        }
        
        private String getFlightsJson() throws Exception {
            StringBuilder json = new StringBuilder();
            json.append("[");

            try (Connection conn = DriverManager.getConnection(DB_URL);
                Statement stmt = conn.createStatement()) {

                ResultSet rs = stmt.executeQuery(
                    "SELECT p.id, p.name, p.airline, p.flight_number, p.departure_airport, p.arrival_airport, " +
                    "fs.status, fs.latitude, fs.longitude, fs.altitude, fs.velocity " +
                    "FROM passengers p " +
                    "LEFT JOIN (" +
                    "    SELECT fs1.* FROM flight_status fs1 " +
                    "    JOIN (" +
                    "        SELECT passenger_id, MAX(last_update) as max_update " +
                    "        FROM flight_status " +
                    "        GROUP BY passenger_id" +
                    "    ) fs2 ON fs1.passenger_id = fs2.passenger_id AND fs1.last_update = fs2.max_update" +
                    ") fs ON p.id = fs.passenger_id"
                );

                boolean first = true;
                while (rs.next()) {
                    if (!first) {
                        json.append(",");
                    }
                    first = false;

                    json.append("{");
                    json.append("\"id\":").append(rs.getInt("id")).append(",");
                    json.append("\"passengerName\":\"").append(rs.getString("name")).append("\",");
                    json.append("\"airline\":\"").append(rs.getString("airline")).append("\",");
                    json.append("\"flightNumber\":\"").append(rs.getString("flight_number")).append("\",");
                    json.append("\"departureAirport\":\"").append(rs.getString("departure_airport")).append("\",");
                    json.append("\"arrivalAirport\":\"").append(rs.getString("arrival_airport")).append("\",");

                    // Status might be null if no status updates yet
                    String status = rs.getString("status");
                    json.append("\"status\":\"").append(status != null ? status : "unknown").append("\"");

                    // Add coordinates if available
                    if (status != null) {
                        json.append(",\"latitude\":").append(rs.getDouble("latitude"));
                        json.append(",\"longitude\":").append(rs.getDouble("longitude"));
                        json.append(",\"altitude\":").append(rs.getDouble("altitude"));
                        json.append(",\"velocity\":").append(rs.getDouble("velocity"));
                    }

                    json.append("}");
                }
            }

            json.append("]");
            return json.toString();
        }
    }
    
    static class ClearHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            System.out.println("Received clear passengers request: " + exchange.getRequestMethod());
            
            // Enable CORS for development
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type,Authorization");
            
            // Handle OPTIONS preflight request
            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                System.out.println("Handling OPTIONS request");
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            
            if ("POST".equals(exchange.getRequestMethod())) {
                System.out.println("Processing POST request to clear data");
                try {
                    // Very simple approach - just delete everything
                    try (Connection conn = DriverManager.getConnection(DB_URL)) {
                        System.out.println("Connected to database");
                        try (Statement stmt = conn.createStatement()) {
                            System.out.println("Deleting flight_status records");
                            int deleted = stmt.executeUpdate("DELETE FROM flight_status");
                            System.out.println("Deleted " + deleted + " flight_status records");
                        }
                        try (Statement stmt = conn.createStatement()) {
                            System.out.println("Deleting passengers records");
                            int deleted = stmt.executeUpdate("DELETE FROM passengers");
                            System.out.println("Deleted " + deleted + " passenger records");
                        }
                    }
                    
                    String response = "{\"success\":true,\"message\":\"All passenger data cleared successfully\"}";
                    System.out.println("Sending success response: " + response);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(200, response.length());
                    
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(response.getBytes());
                    }
                    
                    System.out.println("Clear passengers request succeeded");
                } catch (Exception e) {
                    System.err.println("Error clearing data: " + e.getMessage());
                    e.printStackTrace();
                    
                    String response = "{\"success\":false,\"message\":\"Internal server error: " + e.getMessage() + "\"}";
                    System.out.println("Sending error response: " + response);
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(500, response.length());
                    try (OutputStream os = exchange.getResponseBody()) {
                        os.write(response.getBytes());
                    }
                }
            } else {
                System.out.println("Method not allowed: " + exchange.getRequestMethod());
                String response = "{\"error\":\"Method not allowed\"}";
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(405, response.length());
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(response.getBytes());
                }
            }
        }
    }
}
