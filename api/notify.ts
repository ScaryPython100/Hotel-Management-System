// Legacy / cached client compatibility handler
// All request storage, inventory reconciliation, and staff email alerts
// are canonically and reliably processed by /api/requests.
// This endpoint returns 200 OK to prevent duplicate email triggers from legacy/cached clients.

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Acknowledge request without double-dispatching Resend email
  return res.status(200).json({
    success: true,
    message: "Handled by canonical /api/requests pipeline"
  });
}
