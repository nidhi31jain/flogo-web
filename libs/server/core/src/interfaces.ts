import { Resource } from '@flogo-web/core';
export { Resource };

export interface Newable<T> {
  new (...args: any[]): T;
}

export interface ResourceRegistrarParams {
  resourceType: string;
  resourceHooks: Newable<ResourceHooks>;
}
export type ResourceRegistrarFn = (params: ResourceRegistrarParams) => void;

export interface BeforeUpdateHookParams<T> {
  changes: Partial<Resource<T>>;
  existingResource: Resource<T>;
  updatedResource: Resource<T>;
}

export interface ResourceHooks<TResourceData = unknown> {
  beforeCreate(
    resource: Partial<Resource<TResourceData>>
  ): Promise<Partial<Resource<TResourceData>>>;
  onImport(data: object): Promise<Resource<TResourceData>>;
  beforeUpdate(
    params: BeforeUpdateHookParams<TResourceData>
  ): Promise<Resource<TResourceData>>;
  beforeExport(resource: Resource<TResourceData>): Promise<object>;
  beforeList(resource: Resource<TResourceData>): Promise<Resource<TResourceData>>;
}

export type GenericResourcePlugin = ResourceHooks<Resource>;