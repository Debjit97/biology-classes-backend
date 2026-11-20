import { IsEmail, IsString, MaxLength, MinLength, IsStrongPassword } from 'class-validator';
export class RegisterTeacherDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(12) @MaxLength(128) @IsStrongPassword({ minLength: 12, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }) password!: string;
  @IsString() @MinLength(2) @MaxLength(100) displayName!: string;
}
