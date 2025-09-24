from typing import Any

from sqlalchemy.ext.declarative import as_declarative, declared_attr


@as_declarative()
class Base:
    """Base class for all database models.
    
    This base class provides common functionality for all models, but does not define
    any columns. Each model is responsible for defining its own columns, ensuring that
    the model matches the actual database schema.
    """

    # Generate __tablename__ automatically
    @declared_attr
    def __tablename__(cls) -> str:
        return cls.__name__.lower()

    def to_dict(self) -> dict[str, Any]:
        """
        Convert model instance to dictionary.
        Excludes SQLAlchemy internal attributes and relationships.
        """
        result = {}
        for column in self.__table__.columns:
            if column.name not in ('password_hash', 'deleted_at'):
                result[column.name] = getattr(self, column.name)
        return result
