import { Order, Product, User } from '@prisma/client';

export interface OrderWithRelations extends Order {
  product: Product;
  buyer: User;
  seller: User;
}

