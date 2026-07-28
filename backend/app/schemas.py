from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class DeleteAccountRequest(BaseModel):
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    is_pro: bool
    plan: str | None = None


class UsageOut(BaseModel):
    date: str
    count: int
    limit: int
    is_pro: bool
    remaining: int


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    # Plain text, or a list of Anthropic-style content blocks (for image input).
    content: str | list[dict[str, Any]]


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class CheckoutRequest(BaseModel):
    plan: Literal["monthly", "yearly"]


class CheckoutResponse(BaseModel):
    url: str


class PortalResponse(BaseModel):
    url: str


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupDay(BaseModel):
    date: str
    count: int


class AdminStatsOut(BaseModel):
    total_users: int
    free_users: int
    pro_monthly: int
    pro_yearly: int
    messages_today: int
    signups_by_day: list[SignupDay]
    estimated_mrr: float


class AdminUserOut(BaseModel):
    id: int
    email: str
    created_at: str
    plan: str  # "free" | "monthly" | "yearly"
    subscription_status: str  # "none" | "active" | "canceled" | ...
    messages_today: int
    daily_limit: int


class AdminUsersOut(BaseModel):
    users: list[AdminUserOut]
    total: int


class UsageDay(BaseModel):
    date: str
    count: int
    limit: int


class AdminUserDetailOut(BaseModel):
    id: int
    email: str
    created_at: str
    plan: str
    subscription_status: str
    current_period_end: str | None
    stripe_customer_id: str | None
    total_messages: int
    usage_history: list[UsageDay]
    impersonation_count: int
    last_impersonated_at: str | None
