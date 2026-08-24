require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// PostgreSQL / Supabase
let pool = null;
const memoryInquiries = [];

function hasPlaceholderDatabaseUrl(value) {
    if (!value) return true;
    return /YOUR_PASSWORD|YOUR_PROJECT_REF|USER:PASSWORD|replace-with|HOST:5432/i.test(value);
}

const configuredDatabaseUrl = String(process.env.DATABASE_URL || '').trim();

if (configuredDatabaseUrl && !hasPlaceholderDatabaseUrl(configuredDatabaseUrl)) {
    pool = new Pool({
        connectionString: configuredDatabaseUrl,
        ssl: { rejectUnauthorized: false }
    });

    pool.on('error', (err) => {
        console.error('PostgreSQL pool error:', err.message);
    });
}

function getDatabaseMode() {
    return pool ? 'database' : 'memory';
}

function requireDatabase(res) {
    if (pool) return true;

    res.status(503).json({
        message: 'Database is not configured. Add a valid DATABASE_URL to the environment.'
    });
    return false;
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '');
}

function buildTransport() {
    if (!process.env.MAIL_HOST || !process.env.MAIL_USER || !process.env.MAIL_PASS) {
        return null;
    }

    return nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT || 587),
        secure: Number(process.env.MAIL_PORT || 587) === 465,
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS
        }
    });
}

function isAdminAuthorized(req) {
    const configuredKey = process.env.ADMIN_KEY;

    if (!configuredKey) return false;

    const providedKey = req.headers['x-admin-key'] || req.query.key;
    return providedKey === configuredKey;
}

function requireAdmin(req, res, next) {
    if (!isAdminAuthorized(req)) {
        return res.status(401).json({
            message: 'Unauthorized. Provide a valid admin key.'
        });
    }
    next();
}

// Health
app.get('/api/health', async (req, res) => {
    let database = 'memory';

    if (pool) {
        try {
            await pool.query('SELECT 1');
            database = 'connected';
        } catch (error) {
            database = 'error';
        }
    }

    res.json({
        status: 'ok',
        service: 'sparcadex-solutions-backend',
        database,
        timestamp: new Date().toISOString()
    });
});

// Public inquiry listing is intentionally disabled.
app.get('/api/inquiries', (req, res) => {
    return res.status(403).json({
        message: 'Forbidden'
    });
});

// Get inquiries - admin only
app.get('/api/admin/inquiries', requireAdmin, async (req, res) => {
    if (pool) {
        try {
            const result = await pool.query(`
                SELECT
                    id,
                    name,
                    email,
                    phone,
                    company,
                    project_type AS "projectType",
                    message,
                    created_at AS "createdAt"
                FROM inquiries
                ORDER BY created_at DESC
            `);

            return res.json({
                count: result.rows.length,
                inquiries: result.rows
            });
        } catch (error) {
            console.error('Failed to load inquiries:', error.message);
            return res.status(500).json({
                message: 'Unable to load inquiries.'
            });
        }
    }

    return res.json({
        count: memoryInquiries.length,
        inquiries: memoryInquiries.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
});

// Delete inquiry - admin only
app.delete('/api/admin/inquiries/:id', requireAdmin, async (req, res) => {
    if (pool) {
        try {
            const result = await pool.query(
                'DELETE FROM inquiries WHERE id = $1 RETURNING id',
                [req.params.id]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    message: 'Inquiry not found.'
                });
            }

            return res.json({
                message: 'Inquiry deleted successfully.'
            });
        } catch (error) {
            console.error('Failed to delete inquiry:', error.message);
            return res.status(500).json({
                message: 'Unable to delete inquiry.'
            });
        }
    }

    const index = memoryInquiries.findIndex(item => item.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({
            message: 'Inquiry not found.'
        });
    }

    memoryInquiries.splice(index, 1);
    return res.json({
        message: 'Inquiry deleted successfully.'
    });
});

// Contact form
app.post('/api/contact', async (req, res) => {
    const {
        name,
        email,
        phone,
        company,
        projectType,
        message
    } = req.body || {};

    if (!name || !email || !message) {
        return res.status(400).json({
            message: 'Name, email, and message are required.'
        });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({
            message: 'Please provide a valid email address.'
        });
    }

    const inquiry = {
        id: (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)),
        name: String(name).trim(),
        email: String(email).trim(),
        phone: String(phone || '').trim(),
        company: String(company || '').trim(),
        projectType: String(projectType || '').trim(),
        message: String(message).trim(),
        createdAt: new Date().toISOString()
    };

    if (!pool) {
        memoryInquiries.unshift(inquiry);
        console.log('Inquiry saved to in-memory store because DATABASE_URL is not configured.');
        return res.status(201).json({
            message: 'Thank you. Your inquiry has been received and we will contact you within 24 hours.',
            inquiry
        });
    }

    try {
        const result = await pool.query(
            `INSERT INTO inquiries
                (name, email, phone, company, project_type, message)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING
                id,
                name,
                email,
                phone,
                company,
                project_type AS "projectType",
                message,
                created_at AS "createdAt"`,
            [
                inquiry.name,
                inquiry.email,
                inquiry.phone,
                inquiry.company,
                inquiry.projectType,
                inquiry.message
            ]
        );

        const savedInquiry = result.rows[0];

        // Email is optional. The inquiry remains saved if email delivery fails.
        try {
            const transport = buildTransport();

            if (transport) {
                const mailTo = process.env.MAIL_TO || process.env.MAIL_USER;

                await transport.sendMail({
                    from: process.env.MAIL_USER,
                    to: mailTo,
                    subject: `New inquiry from ${savedInquiry.name}`,
                    text: `
Name: ${savedInquiry.name}
Email: ${savedInquiry.email}
Phone: ${savedInquiry.phone || 'Not provided'}
Company: ${savedInquiry.company || 'Not provided'}
Project Type: ${savedInquiry.projectType || 'Not provided'}

Message:
${savedInquiry.message}
                    `.trim()
                });

                console.log('Inquiry email sent successfully.');
            } else {
                console.log('Email not configured; inquiry saved to database.');
            }
        } catch (emailError) {
            console.error('Inquiry email failed:', emailError.message);
        }

        return res.status(201).json({
            message: 'Thank you. Your inquiry has been received and we will contact you within 24 hours.',
            inquiry: savedInquiry
        });
    } catch (error) {
        console.error('Failed to save inquiry:', error.message);

        return res.status(500).json({
            message: 'Unable to save your inquiry right now. Please try again later.'
        });
    }
});

// Admin dashboard
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Main website
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'sparcadex_final.html'));
});

// Static assets
app.use(express.static(__dirname));

app.listen(PORT, () => {
    console.log(`Sparcadex backend running on port ${PORT}`);
    console.log(`Admin dashboard available at /admin`);
});
