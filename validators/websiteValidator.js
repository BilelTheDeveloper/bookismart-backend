import Joi from 'joi';

const serviceSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).required(),
  description: Joi.string().allow('').max(500),
  price: Joi.string().allow('').max(64),
  duration: Joi.number().integer().min(5).max(480).default(30),
  active: Joi.boolean().default(true),
});

const businessHourSchema = Joi.object({
  day: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
  open: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(''),
  close: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(''),
  isClosed: Joi.boolean().default(false),
});

const pauseWindowSchema = Joi.object({
  label: Joi.string().trim().allow('').max(80),
  start: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  end: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
});

const teamMemberSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80).required(),
  role: Joi.string().allow('').max(80),
  photo: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
  bio: Joi.string().allow('').max(300),
  specialties: Joi.array().items(Joi.string().trim().max(40)).max(8).default([]),
  socials: Joi.object({
    instagram: Joi.string().allow('').max(200),
    linkedin: Joi.string().allow('').max(200),
  }).default({ instagram: '', linkedin: '' }),
});

export const validateWebsitePayload = (data) => {
  const schema = Joi.object({
    templateId: Joi.string().trim().min(3).max(64).required(),
    category: Joi.string().trim().min(2).max(80).required(),
    name: Joi.string().trim().min(2).max(120).required(),
    slug: Joi.string().trim().allow('').max(140),
    hero: Joi.object({
      title: Joi.string().allow('').max(160),
      slogan: Joi.string().allow('').max(300),
      backgroundImage: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
    }).required(),
    about: Joi.object({
      show: Joi.boolean().default(true),
      title: Joi.string().allow('').max(160),
      text: Joi.string().allow('').max(2000),
      image: Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
    }).required(),
    services: Joi.array().items(serviceSchema).max(50).required(),
    teamSection: Joi.object({
      show: Joi.boolean().default(true),
      title: Joi.string().allow('').max(120),
      subtitle: Joi.string().allow('').max(200),
    }).default({ show: true, title: 'Meet Our Team', subtitle: '' }),
    team: Joi.array().items(teamMemberSchema).max(40).default([]),
    gallery: Joi.object({
      show: Joi.boolean().default(true),
      images: Joi.array().items(Joi.string().uri({ scheme: ['http', 'https'] }).allow('')).max(30).required(),
    }).required(),
    contact: Joi.object({
      phone: Joi.string().allow('').max(40),
      email: Joi.string().email().allow(''),
      address: Joi.string().allow('').max(250),
      socials: Joi.object({
        instagram: Joi.string().allow('').max(120),
        facebook: Joi.string().allow('').max(200),
        tiktok: Joi.string().allow('').max(120),
      }).required(),
    }).required(),
    businessHours: Joi.array().items(businessHourSchema).max(7).required(),
    beforeAfterGallery: Joi.array().items(
      Joi.object({
        before:  Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
        after:   Joi.string().uri({ scheme: ['http', 'https'] }).allow(''),
        caption: Joi.string().allow('').max(120),
      })
    ).max(10).default([]),
    setupConfig: Joi.object({
      maxCustomersPerDay: Joi.number().integer().min(1).max(500).default(25),
      restMinutesBetweenConsultations: Joi.number().integer().min(0).max(180).default(0),
      pauseWindows: Joi.array().items(pauseWindowSchema).max(8).default([]),
      localization: Joi.object({
        country: Joi.string().allow('').max(80),
        city: Joi.string().allow('').max(80),
        address: Joi.string().allow('').max(250),
        timezone: Joi.string().allow('').max(80),
      }).default({ country: '', city: '', address: '', timezone: 'UTC' }),
    }).default({
      maxCustomersPerDay: 25,
      restMinutesBetweenConsultations: 0,
      pauseWindows: [],
      localization: { country: '', city: '', address: '', timezone: 'UTC' },
    }),
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};
