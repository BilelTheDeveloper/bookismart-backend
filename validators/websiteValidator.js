import Joi from 'joi';

const serviceSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).required(),
  description: Joi.string().allow('').max(500),
  price: Joi.string().allow('').max(64),
  active: Joi.boolean().default(true),
});

const businessHourSchema = Joi.object({
  day: Joi.string().valid('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday').required(),
  open: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(''),
  close: Joi.string().pattern(/^\d{2}:\d{2}$/).allow(''),
  isClosed: Joi.boolean().default(false),
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
  });

  return schema.validate(data, { abortEarly: false, stripUnknown: true });
};
