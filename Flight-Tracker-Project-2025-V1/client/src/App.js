import React from 'react';
import { BrowserRouter as Router, Route, Switch, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import FlightStatus from './pages/FlightStatus';
import UploadCSV from './pages/UploadCSV';
import Reports from './pages/Reports';
import './styles/App.css';

function App() {
  // Get the base URL from the homepage in package.json or default to '/flight-tracker'
  const basename = process.env.PUBLIC_URL || '/flight-tracker';
  
  return (
    <Router basename={basename}>
      <div className="app-container">
        <nav className="app-nav">
          <div className="app-title">Flight Tracker</div>
          <ul className="nav-links">
            <li>
              <NavLink exact to="/" activeClassName="active">Dashboard</NavLink>
            </li>
            <li>
              <NavLink to="/upload" activeClassName="active">Upload Passengers</NavLink>
            </li>
            <li>
              <NavLink to="/flights" activeClassName="active">Flight Status</NavLink>
            </li>
            <li>
              <NavLink to="/reports" activeClassName="active">Reports</NavLink>
            </li>
          </ul>
        </nav>
        
        <main className="app-content">
          <Switch>
            <Route exact path="/" component={Dashboard} />
            <Route path="/upload" component={UploadCSV} />
            <Route path="/flights" component={FlightStatus} />
            <Route path="/reports" component={Reports} />
          </Switch>
        </main>
      </div>
    </Router>
  );
}

export default App;
