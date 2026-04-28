import Booking from '../models/Booking.js';
import Website from '../models/Website.js';
import User from '../models/User.js';

/**
 * @desc    Create a new appointment
 * @route   POST /api/bookings/create
 * @access  Public (Customer Facing)
 */
export const createBooking = async (req, res) => {
  try {
    const { 
      merchantId, 
      customerName, 
      customerEmail, 
      customerPhone, 
      serviceTitle, 
      appointmentDate, 
      timeSlot,
      notes 
    } = req.body;

    // 1. Validate Website & Service
    const website = await Website.findById(merchantId);
    if (!website) {
      return res.status(404).json({ success: false, message: "Business not found." });
    }

    const selectedService = website.services.find(s => s.title === serviceTitle && s.active);
    if (!selectedService) {
      return res.status(400).json({ success: false, message: "Service is unavailable or does not exist." });
    }

    // 2. Derive Date Details
    const dateObj = new Date(appointmentDate);
    const dateString = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[dateObj.getDay()];

    // 3. Business Hours Validation
    const dayHours = website.businessHours.find(h => h.day === dayName);
    if (!dayHours || dayHours.isClosed) {
      return res.status(400).json({ success: false, message: `This business is closed on ${dayName}.` });
    }

    // 4. Check for Double Booking (Conflict Check)
    const existingBooking = await Booking.findOne({
      ownerId: website.ownerId,
      dateString,
      timeSlot,
      status: { $ne: 'cancelled' }
    });

    if (existingBooking) {
      return res.status(409).json({ 
        success: false, 
        message: "This time slot is already reserved. Please choose another time." 
      });
    }

    // 5. Create Booking with Snapshot Pricing
    const newBooking = await Booking.create({
      ownerId: website.ownerId,
      merchantId: website._id,
      customerName,
      customerEmail,
      customerPhone,
      service: {
        title: selectedService.title,
        price: selectedService.price, // Snapshot current price
        duration: selectedService.duration || 30
      },
      appointmentDate: dateObj,
      dateString,
      timeSlot,
      dayOfWeek: dayName,
      notes,
      status: 'pending'
    });

    // 6. Response
    res.status(201).json({
      success: true,
      message: "Booking requested successfully!",
      booking: newBooking
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "Conflict: This slot was just taken." });
    }
    res.status(500).json({ success: false, message: "Booking failed", error: error.message });
  }
};

/**
 * @desc    Get all bookings for a specific Professional (Owner Dashboard)
 */
export const getOwnerBookings = async (req, res) => {
  try {
    // req.user.id comes from your protect middleware
    const bookings = await Booking.find({ ownerId: req.user.id }).sort({ appointmentDate: 1 });
    res.status(200).json({ success: true, count: bookings.length, bookings });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch bookings" });
  }
};

/**
 * @desc    Update Booking Status (Confirm/Cancel)
 */
export const updateBookingStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // 'confirmed', 'cancelled', etc.

  try {
    const booking = await Booking.findOneAndUpdate(
      { _id: id, ownerId: req.user.id }, // Ensure the owner owns this booking
      { status },
      { new: true }
    );

    if (!booking) return res.status(404).json({ success: false, message: "Booking not found" });

    res.status(200).json({ success: true, message: `Booking ${status}`, booking });
  } catch (error) {
    res.status(500).json({ success: false, message: "Update failed" });
  }
};