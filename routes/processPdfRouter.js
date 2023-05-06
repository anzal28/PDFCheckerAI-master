const express = require('express');

const authController = require('../controllers/authController');
const pdfController = require('../controllers/pdfController');

const router = express.Router();

router.use(authController.protect, pdfController.checkTokenLimit);

router
  .route('/check-compliance')
  .post(
    pdfController.uploadPdf,
    pdfController.processDocument,
    pdfController.generateReport
  );

router
  .route('/check-references')
  .post(
    pdfController.uploadPdf,
    pdfController.processDocument,
    pdfController.checkReference
  );

module.exports = router;
