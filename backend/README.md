# Jarvis Backend

FastAPI backend for the Jarvis frontend. It provides:

- MongoDB-backed users, threads, messages, and signup verifications
- Email sign-in plus verification-code-based account creation
- Google OAuth sign-in
- JWT-based session auth
- Ollama-powered assistant replies
- Gmail SMTP delivery for branded verification emails

## Quick start

1. Create a virtualenv and install dependencies:

   ```powershell
   cd backend
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in:

   - `OPTIMUS_SECRET_KEY`
   - `OPTIMUS_MONGODB_URL`
   - `OPTIMUS_MONGODB_DATABASE`
   - `OPTIMUS_SMTP_USERNAME`
   - `OPTIMUS_SMTP_PASSWORD`
   - `OPTIMUS_SMTP_FROM_EMAIL`
   - `OPTIMUS_GOOGLE_CLIENT_ID`
   - `OPTIMUS_GOOGLE_CLIENT_SECRET`
   - `OPTIMUS_GOOGLE_REDIRECT_URI`

3. For Gmail SMTP, use an App Password on the sending Google account.

4. Make sure Ollama is running locally and the configured model is available:

   ```powershell
   ollama pull llama3.1:8b
   ```

5. Start the API:

   ```powershell
   uvicorn app.main:app --reload
   ```

The default API base is `http://localhost:8000/api/v1`.
