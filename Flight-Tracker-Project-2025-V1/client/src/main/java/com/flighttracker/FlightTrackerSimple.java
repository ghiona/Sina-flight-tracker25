package com.flighttracker;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.json.JSONArray;
import org.json.JSONObject;

public class FlightTrackerSimple {
    private static final Logger LOGGER = Logger.getLogger(FlightTrackerSimple.class.getName());
    private static final String DB_URL = "jdbc:sqlite:flight_tracker.db";
    private static final int UPDATE_INTERVAL_MINUTES = 15;
    private static final int PORT = 8888;

    public FlightTrackerSimple() {
        initDatabase();
    }

    private void initDatabase() {
        try (Connection conn = DriverManager.getConnection(DB_URL);
             Statement stmt = conn.createStatement()) {
            
            stmt.execute(
                "CREATE TABLE IF NOT EXISTS passengers (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "name TEXT NOT NULL," +
                "airline TEXT NOT NULL," +
                "flight_number TEXT NOT NULL," +
                "departure_airport TEXT NOT NULL," +
                "arrival_airport TEXT NOT NULL," +
                "departure_date TEXT NOT NULL," +
                "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP" +
                ")"
            );
            
            stmt.execute(
                "CREATE TABLE IF NOT EXISTS flight_status (" +
                "id INTEGER PRIMARY KEY AUTOINCREMENT," +
                "passenger_id INTEGER NOT NULL," +
                "status TEXT NOT NULL," +
                "latitude REAL," +
                "longitude REAL," +
                "altitude REAL," +
                "velocity REAL," +
                "heading REAL," +
                "last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP," +
                "FOREIGN KEY (passenger_id) REFERENCES passengers (id)" +
                ")"
            );
            
            LOGGER.info("Database initialized");
            
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Error initializing database", e);
        }
    }

    private void setupServer() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        
        // Add CORS headers to all responses
        server.createContext("/api/flights", new HttpHandler() {
            @Override
            public void handle(HttpExchange exchange) throws IOException {
                // Add CORS headers
                Headers headers = exchange.getResponseHeaders();
                headers.add("Access-Control-Allow-Origin", "*");
                headers.add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                headers.add("Access-Control-Allow-Headers", "Content-Type");

                // Handle preflight requests
                if (exchange.getRequestMethod().equalsIgnoreCase("OPTIONS")) {
                    exchange.sendResponseHeaders(204, -1);
                    return;
                }

                // Handle actual request
                if (exchange.getRequestMethod().equalsIgnoreCase("GET")) {
                    try {
                        String response = getAllFlightsJson();
                        headers.add("Content-Type", "application/json");
                        exchange.sendResponseHeaders(200, response.getBytes().length);
                        try (OutputStream os = exchange.getResponseBody()) {
                            os.write(response.getBytes());
                        }
                    } catch (Exception e) {
                        LOGGER.log(Level.SEVERE, "Error handling request", e);
                        String error = "{\"error\": \"Internal server error\"}";
                        exchange.sendResponseHeaders(500, error.getBytes().length);
                        try (OutputStream os = exchange.getResponseBody()) {
                            os.write(error.getBytes());
                        }
                    }
                } else {
                    exchange.sendResponseHeaders(405, -1);
                }
                exchange.close();
            }
        });

        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
        LOGGER.info("Server started on port " + PORT);
    }

    private String getAllFlightsJson() {
        List<Map<String, Object>> flights = new ArrayList<>();
        
        try (Connection conn = DriverManager.getConnection(DB_URL);
             Statement stmt = conn.createStatement()) {
            
            ResultSet rs = stmt.executeQuery(
                "SELECT p.*, fs.* FROM passengers p " +
                "LEFT JOIN flight_status fs ON p.id = fs.passenger_id " +
                "WHERE fs.id IN (SELECT MAX(id) FROM flight_status GROUP BY passenger_id)"
            );

            while (rs.next()) {
                Map<String, Object> flight = new HashMap<>();
                flight.put("id", rs.getInt("passenger_id"));
                flight.put("passengerName", rs.getString("name"));
                flight.put("airline", rs.getString("airline"));
                flight.put("flightNumber", rs.getString("flight_number"));
                flight.put("departureAirport", rs.getString("departure_airport"));
                flight.put("arrivalAirport", rs.getString("arrival_airport"));
                flight.put("status", rs.getString("status"));
                flight.put("latitude", rs.getDouble("latitude"));
                flight.put("longitude", rs.getDouble("longitude"));
                flight.put("altitude", rs.getDouble("altitude"));
                flight.put("velocity", rs.getDouble("velocity"));
                flights.add(flight);
            }
        } catch (Exception e) {
            LOGGER.log(Level.SEVERE, "Error getting flights", e);
        }

        return new JSONArray(flights).toString();
    }

    public void start() {
        LOGGER.info("Starting flight tracker");
        try {
            setupServer();
        } catch (IOException e) {
            LOGGER.log(Level.SEVERE, "Failed to start server", e);
            return;
        }

        updateAllFlights();
        
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        scheduler.scheduleAtFixedRate(
            this::updateAllFlights,
            UPDATE_INTERVAL_MINUTES,
            UPDATE_INTERVAL_MINUTES,
            TimeUnit.MINUTES
        );
    }

    // Your existing methods (processCSV, updateAllFlights, etc.) remain unchanged
    [Previous implementation of these methods remains the same]

    public static void main(String[] args) {
        FlightTrackerSimple tracker = new FlightTrackerSimple();
        
        if (args.length > 0) {
            String csvFile = args[0];
            LOGGER.info("Processing CSV file: " + csvFile);
            tracker.processCSV(csvFile);
        }
        
        tracker.start();
        
        LOGGER.info("Flight tracker running. Press Ctrl+C to exit.");
        try {
            Thread.currentThread().join();
        } catch (InterruptedException e) {
            LOGGER.info("Flight tracker shutting down.");
        }
    }
}
