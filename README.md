# RetailA2Z Backend API - Customer Master Module (Phase 1)

The Customer Master module manages customer accounts, credit settings, duplicate detection, and store-scoped directory queries for RetailA2Z.

---

## Headers (Required for Scoped Requests)

| Header | Description | Required |
|---|---|---|
| `Authorization` | `Bearer <JWT_TOKEN>` | Yes |
| `x-store-id` | Store ID of the active store context | Yes |

---

## Endpoints Summary

| Method | Endpoint | Allowed Roles | Description |
|---|---|---|---|
| `POST` | `/api/customers` | Admin, Salesman | Create basic customer (admin can set credit; salesman forced to No Credit). Returns 409 DUPLICATE_MOBILE warning if normalized mobile exists without `confirmDuplicate: true`. |
| `GET` | `/api/customers` | Admin, Salesman, Collections | Directory list with search (`name`, `mobile`), filters (`credit_enabled`, `is_active`, `overdue_only`), pagination & sorting. |
| `GET` | `/api/customers/lookup?mobile=` | Admin, Salesman, Collections | Partial and exact mobile lookup for autocompletion suggestions. |
| `GET` | `/api/customers/:id` | Admin, Salesman, Collections | Customer detail record. Returns 403 Access Denied if customer belongs to another store. |
| `PUT` | `/api/customers/:id` | Admin, Salesman | Update basic fields (`name`, `mobile`, `locality`, `business_name`, `gst_number`). Credit fields cannot be edited here. |
| `PUT` | `/api/customers/:id/credit-terms` | Admin only | Update credit terms (`credit_enabled`, `credit_limit`, `credit_days`, `reason`). Appends history to `customer_credit_history`. |
| `PATCH` | `/api/customers/:id/status` | Admin only | Soft activate / deactivate (`is_active: true/false`). Customers are never hard deleted. |
| `GET` | `/api/customers/:id/credit-history` | Admin, Collections | Retrieve full credit term modification history. |

---

## Sample Requests & Responses

### 1. Create Customer
`POST /api/customers`

**Request Body (Admin setting credit terms):**
```json
{
  "name": "Gupta Hardware & Sanitary",
  "mobile": "+91 98203-34455",
  "locality": "Dadar Market",
  "business_name": "Gupta Hardware Pvt Ltd",
  "gst_number": "27AAAAA1234A1Z5",
  "credit_enabled": true,
  "credit_limit": 50000,
  "credit_days": 30
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Customer created successfully.",
  "data": {
    "id": "6afe933b352252fcc53e1393",
    "store_id": "6afe9339352252fcc53e134b",
    "name": "Gupta Hardware & Sanitary",
    "mobile": "+91 98203-34455",
    "normalized_mobile": "9820334455",
    "locality": "Dadar Market",
    "business_name": "Gupta Hardware Pvt Ltd",
    "gst_number": "27AAAAA1234A1Z5",
    "credit_enabled": true,
    "credit_limit": 50000,
    "credit_days": 30,
    "credit_terms_label": "30 days",
    "outstanding_amount": 0,
    "overdue_amount": 0,
    "oldest_overdue_days": 0,
    "is_active": true
  }
}
```

---

### 2. Duplicate Mobile Warning
`POST /api/customers`

**Request Body (When normalized mobile already exists in the same store):**
```json
{
  "name": "Ramesh Sharma Duplicate",
  "mobile": "09820334455",
  "locality": "Dadar"
}
```

**Response (409 Conflict):**
```json
{
  "success": false,
  "warning": "DUPLICATE_MOBILE",
  "message": "A customer with this mobile number already exists in this store.",
  "duplicates": [
    {
      "id": "6afe933b352252fcc53e1393",
      "name": "Gupta Hardware & Sanitary",
      "mobile": "+91 98203-34455",
      "normalized_mobile": "9820334455",
      "locality": "Dadar Market"
    }
  ]
}
```

**To create anyway, send with `confirmDuplicate: true`:**
```json
{
  "name": "Ramesh Sharma Duplicate",
  "mobile": "09820334455",
  "locality": "Dadar",
  "confirmDuplicate": true
}
```

---

### 3. Customer Directory Listing
`GET /api/customers?search=Gupta&credit_enabled=true&page=1&limit=20`

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "6afe933b352252fcc53e1393",
      "name": "Gupta Hardware & Sanitary",
      "mobile": "+91 98203-34455",
      "normalized_mobile": "9820334455",
      "locality": "Dadar Market",
      "credit_terms_label": "30 days",
      "credit_limit": 50000,
      "outstanding_amount": 0,
      "overdue_amount": 0,
      "oldest_overdue_days": 0,
      "is_active": true
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

### 4. Mobile Suggestions Lookup
`GET /api/customers/lookup?mobile=9820`

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "6afe933b352252fcc53e1393",
      "name": "Gupta Hardware & Sanitary",
      "mobile": "+91 98203-34455",
      "normalized_mobile": "9820334455",
      "locality": "Dadar Market",
      "credit_terms_label": "30 days",
      "is_active": true
    }
  ]
}
```

---

### 5. Update Credit Terms (Admin Only)
`PUT /api/customers/:id/credit-terms`

**Request Body:**
```json
{
  "credit_enabled": true,
  "credit_limit": 75000,
  "credit_days": 45,
  "reason": "Increased limit upon credit score review"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Customer credit terms updated successfully.",
  "data": {
    "id": "6afe933b352252fcc53e1393",
    "name": "Gupta Hardware & Sanitary",
    "credit_enabled": true,
    "credit_limit": 75000,
    "credit_days": 45,
    "credit_terms_label": "45 days"
  },
  "history": {
    "customer_id": "6afe933b352252fcc53e1393",
    "old_credit_enabled": true,
    "new_credit_enabled": true,
    "old_credit_limit": 50000,
    "new_credit_limit": 75000,
    "old_credit_days": 30,
    "new_credit_days": 45,
    "changed_by": "6afe9339352252fcc53e134f",
    "changed_at": "2026-11-19T06:12:00.000Z",
    "reason": "Increased limit upon credit score review"
  }
}
```

---

### 6. Toggle Customer Active Status
`PATCH /api/customers/:id/status`

**Request Body:**
```json
{
  "is_active": false
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Customer deactivated successfully.",
  "data": {
    "id": "6afe933b352252fcc53e1393",
    "is_active": false
  }
}
```

---

### 7. Credit Change History
`GET /api/customers/:id/credit-history`

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "6afe933b352252fcc53e13a9",
      "customer_id": "6afe933b352252fcc53e1393",
      "old_credit_enabled": true,
      "new_credit_enabled": true,
      "old_credit_limit": 50000,
      "new_credit_limit": 75000,
      "old_credit_days": 30,
      "new_credit_days": 45,
      "changed_at": "2026-11-19T06:12:00.000Z",
      "reason": "Increased limit upon credit score review"
    }
  ]
}
```
