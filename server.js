// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const propertyRoutes = require('./routes/properties');
const roomRoutes = require('./routes/rooms');
const bookingRoutes = require('./routes/bookings');
const maintenanceRoutes = require('./routes/maintenance');
const packageRoutes = require('./routes/packages');
const tenantRoutes = require('./routes/tenants');
const staffRouter = require('./routes/staff');
const activityRouter = require('./routes/activity');
const reviewRoutes = require('./routes/reviews');
const billsRoutes = require('./routes/bills');
const rentRoutes = require('./routes/rent');
const furnitureRoutes = require('./routes/furniture');
const facilitiesRoutes = require('./routes/facilities');

const app = express();

app.use(cors());
app.use(express.json());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/staff', staffRouter);
app.use('/api/activity', activityRouter);
app.use('/api/reviews', reviewRoutes);
app.use('/api/bills', billsRoutes);
app.use('/api/rent', rentRoutes);
app.use('/api/furniture', furnitureRoutes);
app.use('/api/facilities', facilitiesRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
