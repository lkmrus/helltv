# Payment Service MVP

MVP платежного сервиса на NestJS с SQLite, реализующий двухэтапную оплату и атомарные транзакции.

## Быстрый старт

### Установка и запуск
```bash
# Установка зависимостей
npm install

# База данных уже создана, но при необходимости можно пересоздать:
npx prisma migrate reset  # Пересоздаст БД и выполнит seed

# Запуск в dev режиме
npm run start:dev
```

Приложение запустится на `http://localhost:3050`

## Docker

### Сборка и запуск

```bash
# Собрать и запустить контейнер
docker-compose up --build

# Запустить в фоновом режиме
docker-compose up -d

# Просмотр логов
docker-compose logs -f app

# Остановить контейнер
docker-compose down
```

### Сохранение данных

Docker использует умный скрипт инициализации:
- ✅ **Первый запуск**: Создает БД, применяет миграции, загружает seed данные
- ✅ **Последующие запуски**: Только применяет новые миграции, сохраняет существующие данные
- ✅ **Seed данные выполняются только один раз** (отслеживается через файл-маркер `.initialized`)

### Полный сброс базы данных

Для полного сброса БД и повторного выполнения seed:

```bash
# Остановить и удалить контейнеры
docker-compose down

# Удалить БД и маркер инициализации
rm -f prisma/dev.db prisma/.initialized

# Перезапустить (инициализация с нуля)
docker-compose up --build
```

Или одной командой:
```bash
# Очистить всё и пересобрать
docker-compose down && rm -f prisma/dev.db prisma/.initialized && docker-compose up --build
```

### Тестирование в Docker

```bash
# Запустить сервис
docker-compose up -d

# Подождать запуска
sleep 3

# Протестировать API
curl http://localhost:3050/products

# Просмотр логов для отладки
docker-compose logs -f app
```

### Tестирование

1. Откройте `api-test.http` в VS Code (с REST Client extension)
2. Выполните POST запрос для создания платежной ссылки (секция PAYMENTS)
3. Скопируйте `transactionId` и `paymentIntentId` из ответа
4. Вставьте скопированные значения в секцию WEBHOOKS
5. Выполните POST запрос для эмуляции успешной оплаты
6. Проверьте результаты через GET запросы (секции ACCOUNTS, TRANSACTIONS, ORDERS)

### Структура API

#### Платежи
- `POST /payments/url` - создать платежную ссылку (refill или purchase, с поддержкой частичной оплаты)
- `POST /payments/provider/webhook` - webhook от провайдера

#### Заказы
- `POST /orders/create` - создать заказ напрямую с баланса (если достаточно средств)

#### Чтение данных
- `GET /products` - список продуктов
- `GET /accounts/user/:userId` - баланс счета пользователя
- `GET /transactions/:id` - информация о транзакции
- `GET /orders/:id` - информация о заказе

## Архитектура

### Сценарии оплаты

#### 1. Прямая покупка с баланса
**Условие:** Баланс >= Цена товара

```bash
POST /orders/create { userId, productId }
```

**Что происходит:**
- ✅ Создается PRODUCT_PURCHASE транзакция (User → Service)
- ✅ Баланс списывается немедленно
- ✅ Заказ создается со статусом PAID
- ⚡ Все атомарно в одной транзакции БД

#### 2. Частичная оплата (Баланс + Карта)
**Условие:** 0 < Баланс < Цена товара

```bash
POST /payments/url { userId, productId }
```

**Что происходит:**
- ✅ Создается первая PRODUCT_PURCHASE (списание баланса)
- ✅ Баланс списывается немедленно
- ⏳ Создается ACCOUNT_REFILL (для остатка через карту)
- 📧 Возвращается payment URL для оплаты остатка
- ⏳ После webhook создается вторая PRODUCT_PURCHASE (остаток)
- ✅ Заказ создается со статусом PAID
- ⚡ Webhook обработка атомарна

**Пример:** Баланс $30, товар $100
- Немедленно: -$30 с баланса (PRODUCT_PURCHASE #1)
- Карта: +$70 пополнение → -$70 списание (ACCOUNT_REFILL + PRODUCT_PURCHASE #2)
- Итого: баланс не изменился, заказ на $100 оплачен

#### 3. Полная оплата картой
**Условие:** Баланс = 0

```bash
POST /payments/url { userId, productId }
```

**Что происходит (классический flow):**
- ⏳ Создается ACCOUNT_REFILL (пополнение)
- 📧 Возвращается payment URL
- ⏳ После webhook создается PRODUCT_PURCHASE
- ✅ Заказ создается со статусом PAID
- ⚡ Все атомарно в webhook обработке

### Двухэтапная оплата (legacy)
1. **ACCOUNT_REFILL** - внешнее пополнение баланса (service → user)
2. **PRODUCT_PURCHASE** - списание на заказ (user → service)

Все операции выполняются атомарно в одной транзакции БД.

### Ключевые компоненты
- **TransactionsService** - ядро системы, атомарные операции
- **PaymentsService** - оркестрация платежей
- **StubProviderService** - заглушка платежного провайдера
- **AccountsService** - управление балансами
- **EventEmitter2** - система событий

### База данных (SQLite)
- **User** - пользователи (id=1 SERVICE, id=2 USER)
- **Account** - счета (balance, incoming, outgoing)
- **Product** - продукты (id=1, price=$100)
- **Transaction** - финансовые транзакции
- **Order** - заказы

Seed данные: 2 пользователя с балансом $10,000, 1 продукт за $100.

## Инварианты

✅ Все изменения балансов в одной транзакции БД
✅ События только после commit
✅ Идемпотентность webhook (UNIQUE индексы)
✅ Валюта USD (хардкод)
✅ Двухэтапная оплата обязательна

## Memory Bank

Документация проекта находится в `/memory-bank/`:
- `projectbrief.md` - цели и требования
- `productContext.md` - бизнес-логика
- `systemPatterns.md` - архитектура и паттерны
- `techContext.md` - технологии
- `activeContext.md` - текущий статус
- `progress.md` - прогресс реализации

См. также `TODO.md` для детального плана.

## Разработка

### Сборка
```bash
npm run build
```

### База данных
```bash
# Создать миграцию
npx prisma migrate dev --name <name>

# Применить seed
npm run db:seed

# Prisma Studio (GUI)
npx prisma studio
```

### Тестирование атомарности

Проект включает тест для проверки атомарности операций и защиты от race conditions:

```bash
# Запустить сервер
npm run start:dev

# В другом терминале запустить тест
npm run test:concurrency
```

**Тест проверяет:**
- ✅ Идемпотентность webhook (10 параллельных запросов)
- ✅ Атомарность обновления балансов
- ✅ Отсутствие race conditions
- ✅ Консистентность данных

См. `ATOMICITY_TEST_RESULTS.md` для деталей.

## Логирование

Префиксы в логах:
- `[PAYMENT]` - создание платежей
- `[WEBHOOK]` - обработка webhook
- `[TRANSACTION]` - завершение транзакций
- `[ORDER]` - создание заказов
- `[EVENT]` - публикация событий
- `[ACCOUNT]` - изменения балансов
