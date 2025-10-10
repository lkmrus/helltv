# HellTV Payment Service - Упрощенная система списания баланса

> Система управления балансами пользователей с аудитом через историю транзакций

## 🚀 Быстрый старт

### Требования
- Docker & Docker Compose
- Node.js 18+
- npm

### 1. Клонирование и установка
```bash
npm install
```

### 2. Запуск инфраструктуры
```bash
docker-compose up -d postgres redis
```

### 3. Настройка базы данных
```bash
# Применить миграции
DATABASE_URL="postgresql://user:password@localhost:5432/dbname?schema=public" \
  npx prisma migrate deploy

# Заполнить тестовыми данными
DATABASE_URL="postgresql://user:password@localhost:5432/dbname?schema=public" \
  npm run db:seed
```

### 4. Запуск приложения
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/dbname?schema=public" \
  npm run start:dev
```

Приложение запустится на `http://localhost:3050`

### 5. Тестирование

#### Вариант А: Веб-интерфейс (рекомендуется)
Откройте `index.html` в браузере для визуального тестирования:
```bash
open index.html  # macOS
# или просто откройте файл в браузере
```

**⚠️ Важно:** Убедитесь, что сервер запущен на `http://localhost:3050` перед использованием веб-интерфейса.

Веб-интерфейс предоставляет:
- 🎨 Компактный современный UI с двухколоночным layout
- 👥 Выбор пользователя из dropdown (загружается через API)
- 📊 Таблицу истории транзакций с прокруткой
- 🔒 Автоматическое скрытие кнопок Credit/Debit для SERVICE account
- 💼 Отображение бейджа "SERVICE ACCOUNT" для id=1
- ⚙️ Настройку параметров (baseUrl, productId, amount)
- ✅ Цветовую индикацию успеха/ошибок
- 🔄 CORS поддержка (origin: true)

#### Вариант Б: HTTP файлы
Откройте `api-test.http` в VS Code (требуется расширение REST Client) и выполняйте запросы.

## 📚 API

### Получить всех пользователей
```http
GET /users
```

Возвращает список всех пользователей системы (исключая SERVICE account).

**Примечание:** SERVICE account (id=1) не возвращается через API, но доступен в веб-интерфейсе через хардкод.

### Пополнение баланса
```http
POST /accounts/user/:userId/credit
Content-Type: application/json

{
  "amount": 500.00
}
```

### Списание баланса
```http
POST /accounts/user/:userId/debit
Content-Type: application/json

{
  "amount": 50.00
}
```

### Покупка продукта
```http
POST /accounts/user/:userId/debit
Content-Type: application/json

{
  "amount": 100.00,
  "productId": 1
}
```

### Аудит баланса
```http
GET /accounts/user/:userId/audit
```

Возвращает:
```json
{
  "accountId": 2,
  "currentBalance": "10000",
  "calculatedBalance": "10000",
  "difference": "0",
  "isValid": true
}
```

### История транзакций
```http
GET /accounts/user/:userId/history
```

### Текущий баланс
```http
GET /accounts/user/:userId
```

## 🏗️ Архитектура

### Технологии
- **NestJS 11** - Backend framework
- **PostgreSQL 16** - База данных
- **Redis 7** - Кеширование
- **Prisma 6** - ORM
- **TypeScript** - Язык программирования

### Ключевые фичи

#### ⭐ Аудит баланса через историю
```typescript
// account.balance - это кеш
// SUM(transactions) - это source of truth

const calculatedBalance = SUM(incoming) - SUM(outgoing);
if (|account.balance - calculatedBalance| > 0.01) {
  throw new Error('Balance audit failed');
}
```

**Асинхронный аудит:**
- Audit запускается автоматически после каждой транзакции (async)
- Не блокирует пользовательские операции
- Ошибки логируются для мониторинга
- Для ручной проверки: `GET /accounts/user/:userId/audit`

#### 🔒 Атомарные операции с retry
- Все изменения балансов в `retryableTransaction`
- Автоматический retry при deadlock/serialization errors
- До 3 попыток с интервалом 500ms

#### ⚡ Кеширование в Redis
- Users: TTL 5 минут
- Products: TTL 15 минут
- Graceful fallback к PostgreSQL

## 📊 Структура БД

### User
- id (1 = SERVICE, 2+ = пользователи)
- email
- role (SERVICE | USER)

### Account
- userId (1:1 с User)
- **balance** (кеш, начальный баланс: SERVICE=$1M, USER=$0)
- **incoming** (source of truth)
- **outgoing** (source of truth)
- currency (всегда USD)

**Важно:** 
- Service account (id=1): $1,000,000 - не аудируется через историю
- User accounts: $0 начальный баланс - используйте CREDIT для пополнения

### Transaction
- type (CREDIT | DEBIT)
- state (PENDING | HOLD | COMPLETED | FAILED)
- accountAId → accountBId
- amountOut, amountIn
- createdAt, completedAt

### Product
- title, price
- active

### Order
- productId, buyerUserId, sellerUserId
- totalPrice
- status (PAID)

## 🔑 Ключевые концепции

### CREDIT (пополнение)
```
Service Account (id=1) → User Account
```
Используется для внешних поступлений средств.

### DEBIT (списание)
```
User Account → Service Account (id=1)
```
Используется для покупок и списаний. Проверяет достаточность средств.

### Service Account
Виртуальный счет (userId=1) для всех внешних операций. В реальной системе это может быть:
- Внешние платежи (карты, PayPal)
- Выплаты продавцам
- Комиссии системы

## 📁 Структура проекта

```
helltv/
├── prisma/
│   ├── schema.prisma       # Модели БД
│   ├── migrations/         # Миграции
│   └── seed.ts            # Тестовые данные
├── src/
│   ├── modules/
│   │   ├── redis/         # Redis кеш
│   │   ├── prisma/        # БД + retryableTransaction
│   │   ├── users/         # Пользователи (с кешем)
│   │   ├── products/      # Продукты (с кешем)
│   │   ├── accounts/      # Счета + API endpoints
│   │   ├── transactions/  # Транзакции (CORE)
│   │   ├── orders/        # Заказы
│   │   └── events/        # Event listeners
│   ├── common/
│   │   ├── enums/         # TransactionType, State
│   │   └── dto/           # DTOs для валидации
│   └── config/
│       └── config.ts      # Конфигурация
├── memory-bank/           # Документация проекта
├── api-test.http          # HTTP тесты
├── index.html             # Vue.js веб-интерфейс для тестирования
└── docker-compose.yaml    # PostgreSQL + Redis
```

## 🛠️ Разработка

### Создать миграцию
```bash
npx prisma migrate dev --name migration_name
```

### Prisma Studio (GUI для БД)
```bash
npx prisma studio
```

### Пересоздать БД
```bash
npx prisma migrate reset
```

### Сборка
```bash
npm run build
```

## 📖 Документация

Полная документация в папке `memory-bank/`:
- Описание проекта и требования
- Бизнес-процессы и архитектурные паттерны
- Технические детали и текущее состояние

## 🎯 Примеры использования

### Веб-интерфейс (index.html)

1. **Откройте index.html в браузере**
2. **Проверьте баланс:** Нажмите "Выполнить" в карточке "Get Balance"
3. **Пополните баланс:** Введите сумму (например, 500) и нажмите "Выполнить" в "Credit Balance"
4. **Купите продукт:** Нажмите "Выполнить" в "Purchase Product"
5. **Проверьте аудит:** Нажмите "Выполнить" в "Audit Balance"
6. **Посмотрите историю:** Нажмите "Выполнить" в "Transaction History"

### HTTP API (api-test.http)

### Сценарий 1: Пополнение и покупка
```bash
# 1. Пополнить баланс на $500
POST /accounts/user/2/credit { amount: 500 }

# 2. Купить продукт за $100
POST /orders/create { userId: 2, productId: 1 }

# 3. Проверить баланс (должен быть $400)
GET /accounts/user/2

# 4. Проверить аудит
GET /accounts/user/2/audit
```

### Сценарий 2: Недостаточно средств
```bash
# Попытка списать больше чем есть
POST /accounts/user/2/debit { amount: 999999 }

# Ответ: 400 Bad Request
{
  "statusCode": 400,
  "message": "Insufficient balance. Available: 0, Required: 999999"
}
```

### Сценарий 3: История операций
```bash
# Несколько операций
POST /accounts/user/2/credit { amount: 1000 }
POST /accounts/user/2/debit { amount: 200 }
POST /accounts/user/2/debit { amount: 300 }

# Получить историю
GET /accounts/user/2/history

# Проверить консистентность
GET /accounts/user/2/audit
```

## 🐛 Troubleshooting

### Веб-интерфейс не работает (ERR_FAILED / CORS)
```bash
# 1. Убедитесь что сервер запущен
npm run start:dev

# 2. Проверьте что CORS настроен (main.ts должен содержать app.enableCors())
# 3. Перезапустите сервер после изменений в main.ts
# 4. Проверьте URL в веб-интерфейсе (по умолчанию: http://localhost:3050)
# 5. Откройте консоль браузера (F12) для просмотра ошибок
```

### База данных не подключается
```bash
# Проверить что PostgreSQL запущен
docker-compose ps postgres

# Проверить логи
docker-compose logs postgres

# Перезапустить
docker-compose restart postgres
```

### Redis не работает
```bash
# Проверить что Redis запущен
docker-compose ps redis

# Приложение работает и без Redis (fallback к БД)
```

### Ошибка миграций
```bash
# Сбросить и применить заново
npx prisma migrate reset --force
```

## 📄 Лицензия

MIT

## 🤝 Contributing

Pull requests приветствуются!

---

**Разработано с ❤️ для демонстрации правильной работы с финансовыми транзакциями**
