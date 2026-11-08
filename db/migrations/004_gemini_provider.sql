ALTER TABLE extractions DROP CONSTRAINT extractions_provider_check;
ALTER TABLE extractions ADD CONSTRAINT extractions_provider_check CHECK(provider IN ('FIXTURE','OPENAI','GROQ','GEMINI'));
